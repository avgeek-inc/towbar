import { desc, inArray } from "drizzle-orm";
import type { servers } from "@workspace/towbar-database/schema";
import { serverPreparations } from "@workspace/towbar-database/schema";
import { getTowbarDatabase } from "../../infrastructure/database.js";
export async function getLatestServerPreparations(serverIds: string[]) {
  if (serverIds.length === 0) {
    return new Map<
      string,
      {
        configDigest: string;
        status: "queued" | "running" | "succeeded" | "failed";
      }
    >();
  }
  const preparations = await getTowbarDatabase()
    .selectDistinctOn([serverPreparations.serverId], {
      configDigest: serverPreparations.configDigest,
      serverId: serverPreparations.serverId,
      status: serverPreparations.status,
    })
    .from(serverPreparations)
    .where(inArray(serverPreparations.serverId, serverIds))
    .orderBy(serverPreparations.serverId, desc(serverPreparations.createdAt));
  return new Map(
    preparations.map((preparation) => [
      preparation.serverId,
      {
        configDigest: preparation.configDigest,
        status: preparation.status,
      },
    ]),
  );
}

export function toPublicServer(
  server: typeof servers.$inferSelect,
  latestPreparation?: {
    configDigest: string;
    status: "queued" | "running" | "succeeded" | "failed";
  },
) {
  const {
    configDigest,
    privateKeyId: _privateKeyId,
    preparedConfigDigest,
    workspaceId: _workspaceId,
    ...publicServer
  } = server;
  const ready =
    Boolean(server.preparedAt) && preparedConfigDigest === configDigest;
  const currentPreparation = latestPreparation?.configDigest === configDigest;
  return {
    ...publicServer,
    setupStatus: ready
      ? ("ready" as const)
      : currentPreparation &&
          (latestPreparation.status === "queued" ||
            latestPreparation.status === "running")
        ? ("preparing" as const)
        : currentPreparation && latestPreparation.status === "failed"
          ? ("failed" as const)
          : ("pending" as const),
  };
}
