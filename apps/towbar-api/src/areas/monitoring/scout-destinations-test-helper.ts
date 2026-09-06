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
      condition: { ...scoutAlertPresets[1]!.condition, durationSeconds: 0 },
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
  await deleteScoutAlertRule({ ...scope, ruleId: rule.id });
}
