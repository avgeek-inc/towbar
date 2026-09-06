import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import {
  type ScoutAlertRuleInput,
  scoutAlertRuleSchema,
  scoutMuteSchema,
} from "@workspace/towbar-core";
import {
  apps,
  auditEvents,
  notificationDestinations,
  scoutAlertIncidents,
  scoutAlertRules,
  scoutAlertSettings,
  servers,
} from "@workspace/towbar-database/schema";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { badRequest, conflict, notFound } from "../../http/errors.js";
import { getServer } from "../servers/service.js";
import { notificationProviderAvailability } from "../notifications/configuration.js";

export type ScoutScope = { serverId: string; workspaceId: string };
type Database = ReturnType<typeof getTowbarDatabase>;
export type ScoutTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];

export async function listScoutAlertRules(scope: ScoutScope) {
  await getServer(scope.serverId, scope.workspaceId);
  const database = getTowbarDatabase();
  const [rules, settings, destinations] = await Promise.all([
    database
      .select()
      .from(scoutAlertRules)
      .where(
        and(
          eq(scoutAlertRules.serverId, scope.serverId),
          eq(scoutAlertRules.workspaceId, scope.workspaceId),
          isNull(scoutAlertRules.deletedAt),
        ),
      )
      .orderBy(desc(scoutAlertRules.createdAt))
      .limit(100),
    database
      .select()
      .from(scoutAlertSettings)
      .where(eq(scoutAlertSettings.serverId, scope.serverId))
      .limit(1),
    database
      .select({
        id: notificationDestinations.id,
        provider: notificationDestinations.provider,
        config: notificationDestinations.config,
        enabled: notificationDestinations.enabled,
        categories: notificationDestinations.categories,
        sourceId: notificationDestinations.sourceId,
        serverId: notificationDestinations.serverId,
      })
      .from(notificationDestinations)
      .where(
        and(
          eq(notificationDestinations.workspaceId, scope.workspaceId),
          isNull(notificationDestinations.deletedAt),
          or(
            eq(notificationDestinations.serverId, scope.serverId),
            sql`${notificationDestinations.sourceId} in (select source_id from towbar_apps where server_id=${scope.serverId}::uuid and workspace_id=${scope.workspaceId}::uuid and archived_at is null)`,
          ),
        ),
      )
      .limit(200),
  ]);
  return {
    rules,
    settings: settings[0] ?? { mutedUntil: null, muteReason: "" },
    destinations,
    providers: notificationProviderAvailability(),
  };
}

export async function saveScoutAlertRule(
  input: ScoutScope & {
    ruleId?: string;
    rule: ScoutAlertRuleInput;
    requestedBy: string;
  },
) {
  const rule = scoutAlertRuleSchema.parse(input.rule);
  const database = getTowbarDatabase();
  return database.transaction(async (tx) => {
    // Serialize admission with removal, other rule creates, and workload moves.
    await lockScoutServer(tx, input);
    const sourceId = await validateWorkload(tx, input, rule.deployableId);
    if (rule.destinationIds.length) {
      const destinations = await tx
        .select()
        .from(notificationDestinations)
        .where(
          and(
            inArray(notificationDestinations.id, rule.destinationIds),
            eq(notificationDestinations.workspaceId, input.workspaceId),
            isNull(notificationDestinations.deletedAt),
            or(
              eq(notificationDestinations.serverId, input.serverId),
              sourceId
                ? eq(notificationDestinations.sourceId, sourceId)
                : undefined,
            ),
          ),
        )
        .for("share");
      if (destinations.length !== rule.destinationIds.length)
        throw badRequest(
          "Choose destinations belonging to this server or the workload’s source",
        );
      if (destinations.some((d) => !d.categories.includes("scout")))
        throw badRequest(
          "Enable the Scout category on each selected destination",
        );
      const providers = notificationProviderAvailability();
      if (
        rule.enabled &&
        destinations.some((d) => !d.enabled || !providers[d.provider])
      )
        throw conflict(
          "Enable the selected destinations and configure their providers first",
        );
    }
    let result;
    if (input.ruleId) {
      const [old] = await tx
        .select()
        .from(scoutAlertRules)
        .where(
          and(
            eq(scoutAlertRules.id, input.ruleId),
            eq(scoutAlertRules.serverId, input.serverId),
            eq(scoutAlertRules.workspaceId, input.workspaceId),
            isNull(scoutAlertRules.deletedAt),
          ),
        )
        .for("update")
        .limit(1);
      if (!old) throw notFound("Scout alert rule");
      const conditionChanged =
        JSON.stringify(old.condition) !== JSON.stringify(rule.condition) ||
        old.deployableId !== rule.deployableId ||
        old.environment !== rule.environment;
      if (conditionChanged || !rule.enabled)
        await resolveRuleIncidents(
          tx,
          input.ruleId,
          conditionChanged ? "rule_changed" : "rule_disabled",
        );
      [result] = await tx
        .update(scoutAlertRules)
        .set({
          ...rule,
          updatedAt: new Date(),
          ...(conditionChanged
            ? {
                evaluatedAt: null,
                evaluationState: "unknown",
                observedValue: null,
              }
            : {}),
        })
        .where(eq(scoutAlertRules.id, input.ruleId))
        .returning();
    } else {
      const existing = await tx
        .select({ id: scoutAlertRules.id })
        .from(scoutAlertRules)
        .where(
          and(
            eq(scoutAlertRules.serverId, input.serverId),
            isNull(scoutAlertRules.deletedAt),
          ),
        )
        .limit(100);
      if (existing.length >= 100)
        throw conflict("A server supports up to 100 Scout alert rules");
      [result] = await tx
        .insert(scoutAlertRules)
        .values({
          ...rule,
          workspaceId: input.workspaceId,
          serverId: input.serverId,
        })
        .returning();
    }
    if (!result) throw new Error("Scout rule was not saved");
    await tx
      .insert(auditEvents)
      .values({
        workspaceId: input.workspaceId,
        actorUserId: input.requestedBy,
        action: input.ruleId ? "scout.rule_updated" : "scout.rule_created",
        targetType: "server",
        targetId: input.serverId,
        metadata: { ruleId: result.id },
      });
    return result;
  });
}

export async function deleteScoutAlertRule(
  input: ScoutScope & { ruleId: string; requestedBy: string },
) {
  await getTowbarDatabase().transaction(async (tx) => {
    await lockScoutServer(tx, input);
    const [row] = await tx
      .update(scoutAlertRules)
      .set({ enabled: false, deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(scoutAlertRules.id, input.ruleId),
          eq(scoutAlertRules.workspaceId, input.workspaceId),
          eq(scoutAlertRules.serverId, input.serverId),
          isNull(scoutAlertRules.deletedAt),
        ),
      )
      .returning({ id: scoutAlertRules.id });
    if (!row) throw notFound("Scout alert rule");
    await resolveRuleIncidents(tx, row.id, "rule_deleted");
    await tx
      .insert(auditEvents)
      .values({
        workspaceId: input.workspaceId,
        actorUserId: input.requestedBy,
        action: "scout.rule_deleted",
        targetType: "server",
        targetId: input.serverId,
        metadata: { ruleId: row.id },
      });
  });
}

export async function muteScoutAlerts(
  input: ScoutScope & {
    ruleId?: string;
    requestedBy: string;
    durationSeconds: number;
    reason: string;
  },
  now = new Date(),
) {
  const mute = scoutMuteSchema.parse({
    durationSeconds: input.durationSeconds,
    reason: input.reason,
  });
  const values = {
    mutedUntil: mute.durationSeconds
      ? new Date(now.getTime() + mute.durationSeconds * 1000)
      : null,
    muteReason: mute.durationSeconds ? mute.reason : "",
    updatedAt: now,
  };
  return getTowbarDatabase().transaction(async (tx) => {
    await lockScoutServer(tx, input);
    if (input.ruleId) {
      const [row] = await tx
        .update(scoutAlertRules)
        .set(values)
        .where(
          and(
            eq(scoutAlertRules.id, input.ruleId),
            eq(scoutAlertRules.serverId, input.serverId),
            eq(scoutAlertRules.workspaceId, input.workspaceId),
            isNull(scoutAlertRules.deletedAt),
          ),
        )
        .returning({ id: scoutAlertRules.id });
      if (!row) throw notFound("Scout alert rule");
    } else
      await tx
        .insert(scoutAlertSettings)
        .values({ serverId: input.serverId, ...values })
        .onConflictDoUpdate({
          target: scoutAlertSettings.serverId,
          set: values,
        });
    await tx
      .insert(auditEvents)
      .values({
        workspaceId: input.workspaceId,
        actorUserId: input.requestedBy,
        action: mute.durationSeconds ? "scout.muted" : "scout.unmuted",
        targetType: "server",
        targetId: input.serverId,
        metadata: {
          ruleId: input.ruleId ?? null,
          mutedUntil: values.mutedUntil?.toISOString() ?? null,
          reason: values.muteReason,
        },
      });
    return values;
  });
}

export async function listScoutIncidents(
  input: ScoutScope & {
    state: "active" | "resolved" | "all";
    limit: number;
    before?: string;
    beforeId?: string;
    ruleId?: string;
    deployableId?: string;
  },
) {
  await getServer(input.serverId, input.workspaceId);
  const limit = Math.max(1, Math.min(50, input.limit));
  const rows = await getTowbarDatabase()
    .select()
    .from(scoutAlertIncidents)
    .where(
      and(
        eq(scoutAlertIncidents.workspaceId, input.workspaceId),
        eq(scoutAlertIncidents.serverId, input.serverId),
        input.state === "active"
          ? isNull(scoutAlertIncidents.resolvedAt)
          : input.state === "resolved"
            ? sql`${scoutAlertIncidents.resolvedAt} is not null`
            : undefined,
        input.before
          ? or(
              lt(scoutAlertIncidents.openedAt, new Date(input.before)),
              input.beforeId
                ? and(
                    eq(scoutAlertIncidents.openedAt, new Date(input.before)),
                    lt(scoutAlertIncidents.id, input.beforeId),
                  )
                : undefined,
            )
          : undefined,
        input.ruleId ? eq(scoutAlertIncidents.ruleId, input.ruleId) : undefined,
        input.deployableId
          ? eq(scoutAlertIncidents.deployableId, input.deployableId)
          : undefined,
      ),
    )
    .orderBy(desc(scoutAlertIncidents.openedAt), desc(scoutAlertIncidents.id))
    .limit(limit + 1);
  return {
    incidents: rows.slice(0, limit),
    nextBefore:
      rows.length > limit ? rows[limit - 1]!.openedAt.toISOString() : null,
    nextBeforeId: rows.length > limit ? rows[limit - 1]!.id : null,
  };
}

export async function lockScoutServer(tx: ScoutTransaction, scope: ScoutScope) {
  const [server] = await tx
    .select()
    .from(servers)
    .where(
      and(
        eq(servers.id, scope.serverId),
        eq(servers.workspaceId, scope.workspaceId),
        isNull(servers.archivedAt),
      ),
    )
    .for("update")
    .limit(1);
  if (!server) throw notFound("Server");
  return server;
}
async function validateWorkload(
  tx: ScoutTransaction,
  scope: ScoutScope,
  deployableId: string | null,
) {
  if (!deployableId) return null;
  const [app] = await tx
    .select({ sourceId: apps.sourceId })
    .from(apps)
    .where(
      and(
        eq(apps.id, deployableId),
        eq(apps.serverId, scope.serverId),
        eq(apps.workspaceId, scope.workspaceId),
        isNull(apps.archivedAt),
      ),
    )
    .for("share")
    .limit(1);
  if (!app)
    throw badRequest("Choose an active workload assigned to this server");
  return app.sourceId;
}
export async function resolveRuleIncidents(
  tx: ScoutTransaction,
  ruleId: string,
  reason: string,
  now = new Date(),
) {
  await tx
    .update(scoutAlertIncidents)
    .set({ resolvedAt: now, resolutionReason: reason })
    .where(
      and(
        eq(scoutAlertIncidents.ruleId, ruleId),
        isNull(scoutAlertIncidents.resolvedAt),
      ),
    );
}
