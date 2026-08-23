import { and, eq } from "drizzle-orm";

import { digestValue } from "@workspace/towbar-core";
import { apps, servers } from "@workspace/towbar-database/schema";

import type {
  NormalizedDeployable,
  NormalizedServer,
  ReconciliationAction,
} from "@workspace/towbar-core";
import type { getTowbarDatabase } from "../../infrastructure/database.js";
import type { MaterializedDeploymentDigest } from "./deployment-digests.js";

type Transaction = Parameters<
  Parameters<ReturnType<typeof getTowbarDatabase>["transaction"]>[0]
>[0];

export async function upsertServer(
  transaction: Transaction,
  input: {
    action: ReconciliationAction<NormalizedServer>;
    commitSha: string;
    sourceId: string;
    workspaceId: string;
  },
) {
  const desired = input.action.desired!;
  const digest = digestValue(desired);
  const [existing] = await transaction
    .select({ id: servers.id })
    .from(servers)
    .where(
      and(
        eq(servers.sourceId, input.sourceId),
        eq(servers.canonicalIp, desired.ip),
      ),
    )
    .limit(1);
  let serverId = existing?.id;
  if (serverId) {
    await transaction
      .update(servers)
      .set({
        archivedAt: null,
        config: desired,
        configDigest: digest,
        sourceId: input.sourceId,
        sourceRevision: input.commitSha,
        updatedAt: new Date(),
      })
      .where(eq(servers.id, serverId));
  } else {
    const [created] = await transaction
      .insert(servers)
      .values({
        canonicalIp: desired.ip,
        config: desired,
        configDigest: digest,
        sourceId: input.sourceId,
        sourceRevision: input.commitSha,
        workspaceId: input.workspaceId,
      })
      .returning({ id: servers.id });
    if (!created) throw new Error("Unable to materialize server");
    serverId = created.id;
  }
  return serverId;
}

export async function applyDeployableAction(
  transaction: Transaction,
  input: {
    action: ReconciliationAction<NormalizedDeployable>;
    commitSha: string;
    deploymentDigests: Map<string, MaterializedDeploymentDigest>;
    serverIds: Map<string, string>;
    sourceId: string;
    workspaceId: string;
  },
) {
  if (input.action.action === "archive") {
    if (!input.action.current) return;
    await transaction
      .update(apps)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(apps.id, input.action.current.id));
    return;
  }
  const desired = input.action.desired;
  if (!desired) return;
  const serverId = input.serverIds.get(desired.server);
  if (!serverId)
    throw new Error(`Server '${desired.server}' was not materialized`);
  const deploymentDigest = input.deploymentDigests.get(desired.id);
  if (!deploymentDigest) {
    throw new Error(
      `Deployment digest for '${desired.id}' was not materialized`,
    );
  }
  const values = {
    archivedAt: null,
    config: desired,
    configDigest: digestValue(desired),
    deploymentDigest: deploymentDigest.deploymentDigest,
    description: desired.description ?? null,
    kind: desired.kind ?? "app",
    manifestId: desired.id,
    name: desired.name,
    serverId,
    sourceId: input.sourceId,
    sourceInputDigest: deploymentDigest.sourceInputDigest,
    sourceRevision: input.commitSha,
    updatedAt: new Date(),
    workspaceId: input.workspaceId,
  };
  if (input.action.action === "create") {
    await transaction.insert(apps).values(values);
  } else {
    await transaction
      .update(apps)
      .set(values)
      .where(
        and(eq(apps.sourceId, input.sourceId), eq(apps.manifestId, desired.id)),
      );
  }
}
