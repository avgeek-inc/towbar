import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  scoutAlertPresets,
  scoutAlertRuleSchema,
} from "@workspace/towbar-core";
import {
  notificationDeliveries,
  notificationDestinations,
  notificationEvents,
  scoutAlertIncidents,
} from "@workspace/towbar-database/schema";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import {
  type ScoutScope,
  deleteScoutAlertRule,
  muteScoutAlerts,
  saveScoutAlertRule,
} from "./alert-rules.js";

export async function assertScoutDestinations(
  scope: ScoutScope & { requestedBy: string },
  otherWorkspace: string,
  samples: (at: Date, value: number, count?: number) => Promise<void>,
  sweep: (at: Date) => Promise<unknown>,
) {
  const db = getTowbarDatabase();
  const extraId = randomUUID(),
    foreignId = randomUUID();
  await db.insert(notificationDestinations).values([
    {
      id: extraId,
      workspaceId: scope.workspaceId,
      serverId: scope.serverId,
      provider: "slack",
      config: { channelId: "CSECOND" },
      categories: [],
      enabled: false,
    },
    {
      id: foreignId,
      workspaceId: otherWorkspace,
      serverId: scope.serverId,
      provider: "slack",
      config: { channelId: "CFOREIGN" },
      categories: ["scout"],
      enabled: true,
    },
  ]);
  const rule = await saveScoutAlertRule({
    ...scope,
    rule: scoutAlertRuleSchema.parse({
      name: "Automatic destinations",
      condition: { ...scoutAlertPresets[1]!.condition },
    }),
  });
  const now = new Date(Date.now() + 3600_000);
  await samples(now, 99, 1);
  await sweep(now);
  const sent = await db
    .select({
      id: notificationDeliveries.id,
      cycle: notificationDeliveries.cycle,
      destinationId: notificationDeliveries.destinationId,
      payload: notificationEvents.payload,
    })
    .from(notificationDeliveries)
    .innerJoin(
      notificationEvents,
      eq(notificationEvents.id, notificationDeliveries.eventId),
    );
  const destinations = sent
    .filter((row) => row.payload.details.ruleId === rule.id)
    .map((row) => row.destinationId);
  assert.equal(
    destinations.length,
    2,
    "all server destinations receive the alert automatically",
  );
  assert(
    destinations.includes(extraId),
    "legacy category/enable settings cannot silently disable a Scout destination",
  );
  assert(
    !destinations.includes(foreignId),
    "destinations remain workspace scoped",
  );
  const firingEvents = async () =>
    (
      await db
        .select()
        .from(notificationEvents)
        .where(eq(notificationEvents.workspaceId, scope.workspaceId))
    ).filter(
      (event) =>
        event.type === "scout.firing" &&
        event.payload.details.ruleId === rule.id,
    );
  // Removing one destination must not reopen notification eligibility while
  // another destination still has the original firing delivery queued.
  const removed = sent.find(
    (row) =>
      row.destinationId === extraId && row.payload.details.ruleId === rule.id,
  )!;
  await db
    .update(notificationDestinations)
    .set({ deletedAt: new Date() })
    .where(eq(notificationDestinations.id, extraId));
  const { executeNotificationDeliveryAttempt } =
    await import("../notifications/delivery-service.js");
  assert.equal(
    (
      await executeNotificationDeliveryAttempt({
        deliveryId: removed.id,
        cycle: removed.cycle,
        attempt: 1,
      })
    ).outcome,
    "terminal",
  );
  await samples(new Date(now.getTime() + 30_000), 99, 1);
  await sweep(new Date(now.getTime() + 30_000));
  assert.equal(
    (await firingEvents()).length,
    1,
    "a qualifying active incident stays silent",
  );
  await samples(new Date(now.getTime() + 60_000), 89, 1);
  await sweep(new Date(now.getTime() + 60_000));
  assert.equal(
    (await firingEvents()).length,
    1,
    "recovery does not send a new firing notification",
  );
  await samples(new Date(now.getTime() + 90_000), 99, 1);
  await sweep(new Date(now.getTime() + 90_000));
  const triggered = await firingEvents();
  assert.equal(
    triggered.length,
    2,
    "a fresh qualifying reading after recovery fires immediately",
  );
  assert.notEqual(
    triggered[0]!.payload.details.incidentId,
    triggered[1]!.payload.details.incidentId,
  );
  await deleteScoutAlertRule({ ...scope, ruleId: rule.id });
}

export async function assertConcurrentScoutSuppression(
  scope: ScoutScope & { requestedBy: string },
  samples: (at: Date, value: number, count?: number) => Promise<void>,
  sweep: (at: Date) => Promise<unknown>,
) {
  const db = getTowbarDatabase();
  await db.insert(notificationDestinations).values({
    workspaceId: scope.workspaceId,
    serverId: scope.serverId,
    provider: "slack",
    config: { channelId: "CCONCURRENT" },
    categories: ["scout"],
  });
  const rule = await saveScoutAlertRule({
    ...scope,
    rule: scoutAlertRuleSchema.parse({
      name: "Concurrent suppression",
      condition: { metric: "memoryPercent", threshold: 80 },
    }),
  });
  const now = new Date(Date.now() + 7200_000);
  await samples(now, 99, 1);
  await sweep(now);
  const events = await db
    .select()
    .from(notificationEvents)
    .where(eq(notificationEvents.workspaceId, scope.workspaceId));
  const event = events.find((row) => row.payload.details.ruleId === rule.id)!;
  assert(event);
  const deliveries = await db
    .select()
    .from(notificationDeliveries)
    .where(eq(notificationDeliveries.eventId, event.id));
  assert.equal(deliveries.length, 2);
  await muteScoutAlerts({
    ...scope,
    ruleId: rule.id,
    durationSeconds: 3600,
    reason: "Maintenance",
  });
  const { executeNotificationDeliveryAttempt } =
    await import("../notifications/delivery-service.js");
  const results = await Promise.all(
    deliveries.map((delivery) =>
      executeNotificationDeliveryAttempt({
        deliveryId: delivery.id,
        cycle: delivery.cycle,
        attempt: 1,
      }),
    ),
  );
  assert(results.every((result) => result.outcome === "terminal"));
  const [incident] = await db
    .select()
    .from(scoutAlertIncidents)
    .where(eq(scoutAlertIncidents.ruleId, rule.id));
  assert(
    incident && incident.lastNotifiedAt === null,
    "A fully suppressed batch must re-arm even when deliveries are claimed concurrently",
  );
  await muteScoutAlerts({
    ...scope,
    ruleId: rule.id,
    durationSeconds: 0,
    reason: "",
  });
  await samples(new Date(now.getTime() + 30_000), 99, 1);
  await sweep(new Date(now.getTime() + 30_000));
  const after = await db
    .select()
    .from(notificationEvents)
    .where(eq(notificationEvents.workspaceId, scope.workspaceId));
  assert.equal(
    after.filter(
      (row) =>
        row.payload.details.ruleId === rule.id && row.type === "scout.firing",
    ).length,
    2,
  );
  await deleteScoutAlertRule({ ...scope, ruleId: rule.id });
}
