import { and, eq, isNull } from "drizzle-orm";
import type { LogDrainHealth } from "@workspace/towbar-core";
import { serverLogDrains, servers } from "@workspace/towbar-database/schema";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { getEnv } from "../../env.js";
import { emitNotificationEvent } from "../notifications/service.js";
import { getRuntimeLogDrains } from "../../infrastructure/runtime-log-drains.js";

export async function reportLogDrainHealth(
  serverId: string,
  reports: LogDrainHealth[],
) {
  const db = getTowbarDatabase();
  const result = await db.transaction(async (tx) => {
    const [server] = await tx
      .select()
      .from(servers)
      .where(and(eq(servers.id, serverId), isNull(servers.archivedAt)))
      .for("update");
    if (!server) return;
    const configurations = getRuntimeLogDrains();
    const current = (health: LogDrainHealth) =>
      configurations.some(
        (row) =>
          row.provider === health.provider && row.revision === health.revision,
      );
    const [previous] = await tx
      .select()
      .from(serverLogDrains)
      .where(
        and(
          eq(serverLogDrains.serverId, serverId),
          eq(serverLogDrains.integrationKind, "log-forwarding"),
        ),
      );
    const merged = new Map(
      (previous?.health ?? [])
        .filter(current)
        .map((item) => [item.provider, item]),
    );
    const accepted: LogDrainHealth[] = [];
    for (const health of reports.filter(current)) {
      const existing = merged.get(health.provider);
      if (!existing || existing.changedAt <= health.changedAt) {
        merged.set(health.provider, health);
        accepted.push(health);
      }
    }
    const health = [...merged.values()];
    await tx
      .insert(serverLogDrains)
      .values({ serverId, workspaceId: server.workspaceId, health })
      .onConflictDoUpdate({
        target: [serverLogDrains.serverId, serverLogDrains.integrationKind],
        set: { health },
      });
    return {
      server,
      alerts: accepted.filter(
        (item) =>
          item.incidentId &&
          (item.status === "auth_failure" || item.status === "rate_limited"),
      ),
    };
  });
  if (!result) return;
  for (const health of result.alerts) {
    const auth = health.status === "auth_failure";
    await emitNotificationEvent({
      workspaceId: result.server.workspaceId,
      serverId,
      type: auth ? "log-drain.auth_failure" : "log-drain.rate_limited",
      dedupeKey: `log-drain:${health.provider}:${health.revision}:${health.incidentId}`,
      payload: {
        title: `Log forwarding: ${auth ? "authentication failed" : "rate limited"}`,
        message: auth
          ? `${health.provider} rejected authentication on ${result.server.canonicalIp}. Forwarding has stopped. Update the destination credentials to resume.`
          : `${health.provider} returned HTTP 429 three times on ${result.server.canonicalIp}. Forwarding is paused until ${health.retryAt} (at least 24 hours).`,
        occurredAt: health.changedAt,
        source: null,
        entity: {
          id: serverId,
          kind: "server",
          name: result.server.canonicalIp,
        },
        details: {
          provider: health.provider,
          retryAt: health.retryAt,
          configuration: new URL(
            `/manage/integrations/${health.provider}`,
            getEnv().TOWBAR_APP_BASE_URL,
          ).toString(),
        },
      },
    });
  }
}
