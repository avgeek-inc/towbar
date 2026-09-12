import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import {
  normalizeServerConfiguration,
  scoutAlertConditionSchema,
} from "@workspace/towbar-core";
import {
  scoutAlertRules,
  scoutHttpChecks,
  servers,
} from "@workspace/towbar-database/schema";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { collectScoutHttpChecks } from "./http-checks.js";

export async function assertDueHttpChecksAreNotStarved(workspaceId: string) {
  const db = getTowbarDatabase();
  const serverIds = [randomUUID(), randomUUID(), randomUUID()];
  // Twenty five-minute checks were already claimed for this slot. Their old
  // timestamps must not hide a thirty-second check behind the batch limit.
  const now = new Date("2026-09-07T12:04:00Z");
  const fastUrl = `https://${randomUUID()}.example/health`;
  const rules = Array.from({ length: 21 }, (_, index) => ({
    id: randomUUID(),
    workspaceId,
    serverId: serverIds[Math.floor(index / 10)]!,
    name: `Schedule ${index}`,
    condition: scoutAlertConditionSchema.parse({
      metric: "httpAvailability",
      threshold: 1,
      http: {
        url: index === 20 ? fastUrl : "https://slow.example/health",
        intervalSeconds: index === 20 ? 30 : 300,
      },
    }),
  }));
  try {
    await db.insert(servers).values(
      serverIds.map((id, index) => ({
        id,
        slug: `server-${id}`,
        workspaceId,
        canonicalIp: `192.0.2.${230 + index}`,
        config: normalizeServerConfiguration({
          ip: `192.0.2.${230 + index}`,
          ssh: { username: "deploy" },
        }),
        configDigest: "fixture",
      })),
    );
    const saved = await db.insert(scoutAlertRules).values(rules).returning();
    await db.insert(scoutHttpChecks).values(
      saved.map((rule) => ({
        ruleId: rule.id,
        ruleRevision: rule.updatedAt,
        scheduledAt: new Date(
          rule.condition.http!.intervalSeconds === 30
            ? "2026-09-07T12:03:30Z"
            : "2026-09-07T12:00:00Z",
        ),
        state: "healthy" as const,
      })),
    );
    let fastRequests = 0;
    const probe = (check: { url: string }) => {
      if (check.url === fastUrl) fastRequests++;
      return Promise.resolve({
        state: "healthy" as const,
        statusCode: 200,
        latencyMs: 1,
        reason: null,
      });
    };
    await collectScoutHttpChecks(now, probe);
    assert.equal(
      fastRequests,
      1,
      "Due checks must be selected before applying the batch limit",
    );
    await collectScoutHttpChecks(now, probe);
    assert.equal(fastRequests, 1, "A claimed slot must not be probed twice");
  } finally {
    await db.delete(servers).where(inArray(servers.id, serverIds));
  }
}
