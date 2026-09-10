import { and, eq } from "drizzle-orm";
import { digestValue } from "@workspace/towbar-core";
import type {
  servers,
  sourceEnvironments} from "@workspace/towbar-database/schema";
import {
  apps,
  sourceEntities
} from "@workspace/towbar-database/schema";
import { conflict } from "../../http/errors.js";
import type { getTowbarDatabase } from "../../infrastructure/database.js";
import { reconcileInstanceSecretDeclarations } from "../secrets/declarations.js";
import { calculateDesiredDeploymentDigest } from "./deployment-digests.js";
import type {
  ManifestReconciliation,
  RepositoryTree,
  RequiredSecrets,
} from "@workspace/towbar-core";

type Transaction = Parameters<
  Parameters<ReturnType<typeof getTowbarDatabase>["transaction"]>[0]
>[0];

export async function materializeEnvironment(
  transaction: Transaction,
  input: {
    reconciliation: ManifestReconciliation;
    sourceId: string;
    workspaceId: string;
    environment: typeof sourceEnvironments.$inferSelect;
    commitSha: string;
    tree: RepositoryTree;
    serverBySlug: Map<string, typeof servers.$inferSelect>;
    requiredSecrets: Record<string, RequiredSecrets>;
  },
) {
  const { reconciliation, environment, workspaceId, tree, serverBySlug } =
    input;
  for (const action of [...reconciliation.apps, ...reconciliation.resources]) {
    if (action.action === "archive") {
      if (action.current)
        await transaction
          .update(apps)
          .set({ archivedAt: new Date(), updatedAt: new Date() })
          .where(eq(apps.id, action.current.id));
      continue;
    }
    const entity = action.desired!;
    const entityType = entity.kind === "app" ? "app" : "resource";
    const server = serverBySlug.get(entity.server);
    if (!server)
      throw conflict(
        `Configure server '${entity.server}' before syncing`,
        "SERVER_NOT_CONFIGURED",
      );
    const [logical] = await transaction
      .insert(sourceEntities)
      .values({
        sourceId: input.sourceId,
        manifestId: entity.id,
        entityType,
        resourceType: entity.kind === "app" ? null : entity.kind,
      })
      .onConflictDoNothing()
      .returning();
    const logicalEntity =
      logical ??
      (
        await transaction
          .select()
          .from(sourceEntities)
          .where(
            and(
              eq(sourceEntities.sourceId, input.sourceId),
              eq(sourceEntities.manifestId, entity.id),
              eq(sourceEntities.entityType, entityType),
            ),
          )
      )[0];
    if (
      !logicalEntity ||
      logicalEntity.resourceType !==
        (entity.kind === "app" ? null : entity.kind)
    ) {
      throw conflict(
        `Resource '${entity.id}' cannot change type between environments`,
        "RESOURCE_TYPE_CHANGED",
      );
    }
    const digest = calculateDesiredDeploymentDigest({
      commitSha: input.commitSha,
      deployable: entity,
      repositoryTree: tree,
      server: server.config,
    });
    const values = {
      workspaceId,
      sourceId: input.sourceId,
      entityId: logicalEntity.id,
      sourceEnvironmentId: environment.id,
      serverId: server.id,
      manifestId: entity.id,
      kind: entity.kind,
      name: entity.name,
      description: entity.description ?? null,
      config: entity,
      configDigest: digestValue(entity),
      deploymentDigest: digest.deploymentDigest,
      sourceInputDigest: digest.sourceInputDigest,
      sourceRevision: input.commitSha,
      requiredSecrets: input.requiredSecrets[`${entityType}:${entity.id}`],
      archivedAt: null,
      updatedAt: new Date(),
    };
    const [instance] = action.current
      ? await transaction
          .update(apps)
          .set(values)
          .where(eq(apps.id, action.current.id))
          .returning({ id: apps.id })
      : await transaction
          .insert(apps)
          .values(values)
          .returning({ id: apps.id });
    if (!instance || !values.requiredSecrets)
      throw new Error("Instance secret declarations were not resolved");
    await reconcileInstanceSecretDeclarations(
      {
        appId: instance.id,
        workspaceId,
        environment: environment.name,
        declarations: values.requiredSecrets,
      },
      transaction,
    );
    if (entity.kind === "app" && entity.preview?.enabled) {
      await reconcileInstanceSecretDeclarations(
        {
          appId: instance.id,
          workspaceId,
          environment: `preview:${environment.name}`,
          declarations: values.requiredSecrets,
        },
        transaction,
      );
    }
  }
}
