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
} from "@workspace/towbar-database/schema";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import {
  type ScoutScope,
  deleteScoutAlertRule,
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
