import { and, eq, isNull } from "drizzle-orm";

import {
  digestValue,
  getDeployableDeploymentDigest,
  requiresServerPreparation,
} from "@workspace/towbar-core";
import { apps, servers } from "@workspace/towbar-database/schema";

import { conflict, notFound } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { serverSelection, toPublicServer } from "./service.js";

import type { NormalizedServer } from "@workspace/towbar-core";

export async function createServer(input: {
  config: NormalizedServer;
  workspaceId: string;
}) {
  return await getTowbarDatabase().transaction(async (transaction) => {
    const [existing] = await transaction
      .select(serverSelection)
      .from(servers)
      .where(
        and(
          eq(servers.workspaceId, input.workspaceId),
          eq(servers.canonicalIp, input.config.ip),
        ),
      )
      .for("update")
      .limit(1);
    if (existing && !existing.archivedAt) {
      throw conflict(
        `Server '${input.config.ip}' is already configured`,
        "SERVER_ALREADY_EXISTS",
      );
    }
    const configDigest = digestValue(input.config);
    const [server] = existing
      ? await transaction
          .update(servers)
          .set({
            archivedAt: null,
            config: input.config,
            configDigest,
            preparedConfigDigest: requiresServerPreparation(
              existing.config,
              input.config,
            )
              ? existing.preparedConfigDigest
              : configDigest,
            updatedAt: new Date(),
          })
          .where(eq(servers.id, existing.id))
          .returning(serverSelection)
      : await transaction
          .insert(servers)
          .values({
            canonicalIp: input.config.ip,
            config: input.config,
            configDigest,
            workspaceId: input.workspaceId,
          })
          .returning(serverSelection);
    if (!server) throw new Error("Unable to create server");
    return toPublicServer(server);
  });
}

export async function updateServer(input: {
  config: NormalizedServer;
  serverId: string;
  workspaceId: string;
}) {
  return await getTowbarDatabase().transaction(async (transaction) => {
    const [current] = await transaction
      .select(serverSelection)
      .from(servers)
      .where(
        and(
          eq(servers.id, input.serverId),
          eq(servers.workspaceId, input.workspaceId),
          isNull(servers.archivedAt),
        ),
      )
      .for("update")
      .limit(1);
    if (!current) throw notFound("Server");
    if (input.config.ip !== current.canonicalIp) {
      throw conflict(
        "A server IP cannot be changed. Add a new server instead.",
        "SERVER_IP_IMMUTABLE",
      );
    }
    const configDigest = digestValue(input.config);
    const preservePreparation =
      Boolean(current.preparedAt) &&
      current.preparedConfigDigest === current.configDigest &&
      !requiresServerPreparation(current.config, input.config);
    const [server] = await transaction
      .update(servers)
      .set({
        config: input.config,
        configDigest,
        preparedConfigDigest: preservePreparation
          ? configDigest
          : current.preparedConfigDigest,
        updatedAt: new Date(),
      })
      .where(eq(servers.id, current.id))
      .returning(serverSelection);
    if (!server) throw new Error("Unable to update server");
    const deployables = await transaction
      .select({
        config: apps.config,
        id: apps.id,
        sourceInputDigest: apps.sourceInputDigest,
      })
      .from(apps)
      .where(and(eq(apps.serverId, current.id), isNull(apps.archivedAt)));
    for (const deployable of deployables) {
      await transaction
        .update(apps)
        .set({
          deploymentDigest: getDeployableDeploymentDigest({
            deployable: deployable.config,
            server: input.config,
            sourceInputDigest: deployable.sourceInputDigest,
          }),
          updatedAt: new Date(),
        })
        .where(eq(apps.id, deployable.id));
    }
    return toPublicServer(server);
  });
}
