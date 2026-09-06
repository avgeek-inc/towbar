import assert from "node:assert/strict";
import { and, eq, isNull } from "drizzle-orm";
import { scoutAlertRuleSchema } from "@workspace/towbar-core";
import {
  monitoringAgents,
  scoutAlertIncidents,
  scoutAlertRules,
  scoutHttpChecks,
} from "@workspace/towbar-database/schema";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import {
  type ScoutScope,
  muteScoutAlerts,
  saveScoutAlertRule,
} from "./alert-rules.js";
export async function assertScoutHttpChecks(
  scope: ScoutScope & { requestedBy: string },
  sweep: (at: Date) => Promise<{ errors: number }>,
) {
  const db = getTowbarDatabase();
  const { serverId } = scope;
  const { collectScoutHttpChecks } = await import("./http-checks.js");
  await db
    .update(monitoringAgents)
    .set({ desiredState: "disabled" })
    .where(eq(monitoringAgents.serverId, serverId));
  const httpRule = scoutAlertRuleSchema.parse({
    name: "Website uptime",
    condition: {
      metric: "httpAvailability",
      threshold: 1,
      recoveryThreshold: 0,
      durationSeconds: 0,
      recoverySeconds: 0,
      http: { url: "https://public.example/health" },
    },
  });
  const saved = await saveScoutAlertRule({ ...scope, rule: httpRule });
  let requests = 0;
  const probe = () => {
    requests++;
    return Promise.resolve({
      state: "failed" as const,
      statusCode: 503,
      latencyMs: 5,
      reason: "Unexpected HTTP status",
    });
  };
  const at = new Date(Date.now() + 1000);
  await Promise.all([
    collectScoutHttpChecks(at, probe),
    collectScoutHttpChecks(at, probe),
  ]);
  assert.equal(requests, 1);
  const check = await db
    .select()
    .from(scoutHttpChecks)
    .where(eq(scoutHttpChecks.ruleId, saved.id));
  assert.equal(check.length, 1);
  const evaluation = await sweep(new Date(at.getTime() + 1000));
  assert.equal(evaluation.errors, 0);
  const [incident] = await db
    .select()
    .from(scoutAlertIncidents)
    .where(eq(scoutAlertIncidents.ruleId, saved.id));
  assert(incident && !incident.resolvedAt);
  const changed = {
    ...httpRule,
    condition: {
      ...httpRule.condition,
      http: {
        ...httpRule.condition.http!,
        url: "https://other.example/health",
      },
    },
  };
  await saveScoutAlertRule({
    ...scope,
    ruleId: saved.id,
    rule: changed,
  });
  await sweep(new Date(at.getTime() + 31_000));
  const [state] = await db
    .select()
    .from(scoutAlertRules)
    .where(eq(scoutAlertRules.id, saved.id));
  assert.equal(state?.evaluationState, "unknown");
  assert.equal(
    (
      await db
        .select()
        .from(scoutAlertIncidents)
        .where(
          and(
            eq(scoutAlertIncidents.ruleId, saved.id),
            isNull(scoutAlertIncidents.resolvedAt),
          ),
        )
    ).length,
    0,
  );
  await collectScoutHttpChecks(new Date(at.getTime() + 90_000), () =>
    Promise.resolve({
      state: "healthy" as const,
      statusCode: 204,
      latencyMs: 4,
      reason: null,
    }),
  );
  await sweep(new Date(at.getTime() + 91_000));
  const [recovered] = await db
    .select()
    .from(scoutAlertRules)
    .where(eq(scoutAlertRules.id, saved.id));
  assert.equal(recovered?.evaluationState, "healthy");
  await muteScoutAlerts({
    ...scope,
    ruleId: saved.id,
    durationSeconds: 3600,
    reason: "Test mute",
  });
  await sweep(new Date(at.getTime() + 121_000));
  const [muted] = await db
    .select()
    .from(scoutAlertRules)
    .where(eq(scoutAlertRules.id, saved.id));
  assert.equal(
    muted?.evaluationState,
    "healthy",
    "Muting must not discard valid HTTP history",
  );
}
