import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  scoutAlertPresets,
  scoutAlertRuleSchema,
  scoutMuteSchema,
} from "@workspace/towbar-core/scout-alerts";
import {
  comparisonMetrics,
  compareMetricSummaries,
  summarizeComparisonMetric,
  deploymentComparisonQuerySchema,
} from "@workspace/towbar-core/deployment-comparison";
import type { ComparisonPoint } from "@workspace/towbar-web-client";

type Workload = {
  id: string;
  name: string;
  serverId: string;
  sourceId: string;
  kind?: string;
};
export function createScoutFixture(serverIds: string[], workloads: Workload[]) {
  const now = Date.now();
  const iso = (ago: number) => new Date(now - ago * 60_000).toISOString();
  const destinations = serverIds.map((serverId) => ({
    id: randomUUID(),
    serverId,
    sourceId: null,
    provider: "smtp" as const,
    enabled: true,
    categories: ["scout"],
    config: { recipients: ["operations@example.com"] },
    createdAt: iso(1440),
    updatedAt: iso(1440),
  }));
  const rules = serverIds.flatMap((serverId, serverIndex) =>
    ["disk", "memory", "offline"].map((key, index) => {
      const preset = scoutAlertPresets.find((p) => p.id === key)!;
      return {
        ...scoutAlertRuleSchema.parse({
          name: preset.name,
          severity: preset.severity,
          condition: preset.condition,
        }),
        id: randomUUID(),
        serverId,
        mutedUntil: null as string | null,
        muteReason: "",
        evaluationState: serverIndex
          ? "inactive"
          : index === 0
            ? "firing"
            : "healthy",
        evaluatedAt: iso(0),
        observedValue: index === 0 ? 93.4 : index === 1 ? 45.2 : 12,
      };
    }),
  );
  const workload = workloads.find((w) => w.serverId === serverIds[0]);
  if (workload)
    rules.push({
      ...rules[1]!,
      id: randomUUID(),
      name: `${workload.name} memory pressure`,
      deployableId: workload.id,
      evaluationState: "healthy",
      observedValue: 41,
    });
  const incidents = rules
    .filter((r) => r.serverId === serverIds[0])
    .flatMap((rule, index) =>
      Array.from({ length: index === 0 ? 13 : 1 }, (_, item) => ({
        id: randomUUID(),
        serverId: rule.serverId,
        ruleId: rule.id,
        ruleName: rule.name,
        severity: rule.severity,
        condition: rule.condition,
        environment: rule.environment,
        deployableId: rule.deployableId,
        openedAt: iso(12 + item * 90 + index * 30),
        resolvedAt:
          index === 0 && item === 0 ? null : iso(8 + item * 90 + index * 30),
        resolutionReason: index === 0 && item === 0 ? null : "recovered",
        lastValue:
          index === 0 && item === 0 ? 93.4 : rule.condition.threshold - 5,
        lastNotifiedAt: iso(12 + item * 90 + index * 30),
      })),
    );
  const settings = new Map(
    serverIds.map((id) => [
      id,
      { mutedUntil: null as string | null, muteReason: "" },
    ]),
  );
  const deployments = workloads.flatMap((w) =>
    Array.from({ length: 3 }, (_, index) => ({
      id: randomUUID(),
      deployableId: w.id,
      commitSha: [
        "ad92c1b48bd78f920ddd",
        "c88b05a41bb93c9f411a",
        "bf4028e114bd05234af3",
      ][index]!,
      finishedAt: iso(index === 0 ? 5 : index === 1 ? 240 : 1440),
      environment: "production",
      previewId: null,
      serverId: w.serverId,
      kind: "git",
    })),
  );
  return function handleScoutFixture(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ) {
    const serverMatch = url.pathname.match(
      /^\/v1\/core\/servers\/([^/]+)\/(scout-alerts|notifications)(.*)$/,
    );
    const compareMatch = url.pathname.match(
      /^\/v1\/core\/workloads\/([^/]+)\/(comparison-deployments|deployment-comparison)$/,
    );
    if (!serverMatch && !compareMatch) return false;
    const send = (status: number, data?: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(data === undefined ? undefined : JSON.stringify(data));
    };
    const fail = () =>
      send(404, { error: { message: "Fixture record not found" } });
    if (compareMatch) {
      const workload = workloads.find((w) => w.id === compareMatch[1]);
      if (!workload) {
        fail();
        return true;
      }
      const choices = deployments.filter((d) => d.deployableId === workload.id);
      if (compareMatch[2] === "comparison-deployments") {
        send(200, { deployments: choices });
        return true;
      }
      const result = deploymentComparisonQuerySchema.safeParse(
        Object.fromEntries(url.searchParams),
      );
      if (!result.success) {
        send(400, { error: { message: result.error.issues[0]?.message } });
        return true;
      }
      const query = result.data;
      const sides = [query.baselineId, query.candidateId].map(
        (id, sideIndex) => {
          const deployment = choices.find((d) => d.id === id);
          if (!deployment) return null;
          const start =
            new Date(deployment.finishedAt).getTime() +
            query.warmupMinutes * 60_000;
          const stepSeconds = Math.max(
            60,
            Math.ceil(query.windowMinutes / 240) * 60,
          );
          const points: ComparisonPoint[] = [];
          for (
            let offset = 0;
            offset < query.windowMinutes * 60 &&
            start + offset * 1000 < Date.now();
            offset += stepSeconds
          ) {
            if (offset > 600 && offset < 720) continue;
            const metrics: ComparisonPoint["metrics"] = {};
            for (const [index, definition] of comparisonMetrics.entries()) {
              const base =
                index === 0 ? 0.3 : index === 1 ? 128 * 1024 ** 2 : 42000;
              const value =
                base *
                (1 + Math.sin(offset / 120) * 0.12) *
                (sideIndex && index < 2 ? 1.65 : 1);
              const count = Math.min(
                stepSeconds / 30,
                Math.max(
                  1,
                  Math.floor((Date.now() - start - offset * 1000) / 30000),
                ),
              );
              metrics[definition.metric] = {
                sum: value * count,
                count,
                min: value * 0.95,
                max: value * 1.05,
              };
            }
            points.push({ offsetSeconds: offset, metrics });
          }
          return {
            deployment: {
              ...deployment,
              configDigest: "fixture-config",
              imageDigest: `fixture-image-${sideIndex}`,
            },
            startAt: new Date(start).toISOString(),
            endAt: new Date(start + query.windowMinutes * 60_000).toISOString(),
            windowComplete: start + query.windowMinutes * 60_000 <= Date.now(),
            historyExpired: false,
            restarts: points.length ? sideIndex : null,
            restartCoveragePercent: points.length
              ? Math.min(
                  100,
                  ((points.length * stepSeconds) / (query.windowMinutes * 60)) *
                    100,
                )
              : 0,
            points,
          };
        },
      );
      if (!sides[0] || !sides[1]) {
        fail();
        return true;
      }
      const baseline = sides[0],
        candidate = sides[1];
      send(200, {
        workload: { id: workload.id, name: workload.name },
        query,
        stepSeconds: Math.max(60, Math.ceil(query.windowMinutes / 240) * 60),
        baseline,
        candidate,
        metrics: comparisonMetrics.map((definition) => ({
          ...definition,
          ...compareMetricSummaries(
            summarizeComparisonMetric(
              baseline.points,
              definition.metric,
              query.windowMinutes * 60,
            ),
            summarizeComparisonMetric(
              candidate.points,
              definition.metric,
              query.windowMinutes * 60,
            ),
            {
              ...query,
              ...definition,
              absoluteFloor:
                definition.metric === "cpuCores"
                  ? query.cpuFloorCores
                  : definition.metric === "memoryUsedBytes"
                    ? query.memoryFloorMiB * 1024 ** 2
                    : 0,
            },
          ),
        })),
        warnings: [
          ...(!baseline.windowComplete || !candidate.windowComplete
            ? [
                "The selected observation window is still collecting data. Coverage is measured against the full requested window.",
              ]
            : []),
          "Changes in traffic or workload can affect usage. This comparison does not establish that a deployment caused a regression.",
        ],
      });
      return true;
    }
    const [, serverId, area, rest] = serverMatch!;
    if (!settings.has(serverId!)) {
      fail();
      return true;
    }
    if (request.method === "GET") {
      if (area === "notifications")
        send(200, {
          canManageNotifications: true,
          destinations: destinations.filter((d) => d.serverId === serverId),
          providers: { slack: true, smtp: true },
        });
      else if (rest === "" || rest === "/")
        send(200, {
          canManage: true,
          rules: rules.filter(
            (r) =>
              r.serverId === serverId &&
              (!url.searchParams.has("deployableId") ||
                r.deployableId ===
                  (url.searchParams.get("deployableId") === "server"
                    ? null
                    : url.searchParams.get("deployableId"))),
          ),
          workloads: workloads
            .filter((w) => w.serverId === serverId)
            .map((w) => ({ ...w, kind: w.kind ?? "app" })),
          settings: settings.get(serverId!),
          destinations: destinations.filter((d) => d.serverId === serverId),
          providers: { slack: true, smtp: true },
        });
      else if (rest?.startsWith("/incidents/")) {
        const incident = incidents.find(
          (i) => i.id === rest.slice(11) && i.serverId === serverId,
        );
        if (!incident) fail();
        else {
          const end = Date.now(),
            start = new Date(incident.openedAt).getTime();
          const stepSeconds = Math.max(
            30,
            Math.ceil((end - start) / 360 / 30_000) * 30,
          );
          const workload = workloads.find(
            (w) => w.id === incident.deployableId,
          );
          send(200, {
            incident,
            entity: {
              id: incident.deployableId ?? serverId,
              name:
                workload?.name ??
                `192.0.2.${10 + serverIds.indexOf(serverId!)}`,
              kind: workload?.kind ?? "server",
            },
            history: {
              startAt: incident.openedAt,
              endAt: new Date(end).toISOString(),
              stepSeconds,
              aggregation: "maximum",
              notes: [],
              points: Array.from(
                { length: Math.floor((end - start) / stepSeconds / 1000) + 1 },
                (_, index) => {
                  const at = start + index * stepSeconds * 1000;
                  return {
                    at: new Date(at).toISOString(),
                    value:
                      index === 5 || index === 6
                        ? null
                        : incident.resolvedAt &&
                            at >= new Date(incident.resolvedAt).getTime()
                          ? incident.condition.threshold * 0.55 +
                            Math.sin(index) * 2
                          : incident.condition.threshold +
                            3 +
                            Math.sin(index) * 1.2,
                  };
                },
              ),
            },
          });
        }
      } else if (rest === "/incidents") {
        const state = url.searchParams.get("state") ?? "active",
          before = url.searchParams.get("before"),
          limit = Math.min(50, Number(url.searchParams.get("limit") ?? 10));
        const filtered = incidents
          .filter(
            (i) =>
              i.serverId === serverId &&
              (!url.searchParams.has("deployableId") ||
                i.deployableId ===
                  (url.searchParams.get("deployableId") === "server"
                    ? null
                    : url.searchParams.get("deployableId"))) &&
              (state === "all" ||
                (state === "active" ? !i.resolvedAt : i.resolvedAt)) &&
              (!before || i.openedAt < before),
          )
          .sort((a, b) => b.openedAt.localeCompare(a.openedAt));
        const page = filtered.slice(0, limit),
          last = page.at(-1);
        send(200, {
          incidents: page,
          nextBefore: filtered.length > limit ? last?.openedAt : null,
          nextBeforeId: filtered.length > limit ? last?.id : null,
        });
      } else fail();
      return true;
    }
    void (async () => {
      let body = "";
      for await (const chunk of request) body += String(chunk);
      const input = body ? JSON.parse(body) : {};
      if (area === "notifications") {
        const match = rest!.match(
          /^\/destinations(?:\/([^/]+)(\/actions\/test)?)?$/,
        );
        if (!match) return fail();
        const index = destinations.findIndex(
          (d) => d.id === match[1] && d.serverId === serverId,
        );
        if (match[2])
          return send(202, { delivery: { id: randomUUID(), cycle: 1 } });
        if (request.method === "DELETE") {
          if (index < 0) return fail();
          destinations.splice(index, 1);
          return send(204);
        }
        const destination = {
          ...input,
          id: index < 0 ? randomUUID() : match[1],
          serverId,
          sourceId: null,
          createdAt: iso(0),
          updatedAt: iso(0),
        };
        if (index >= 0) destinations[index] = destination;
        else destinations.push(destination);
        return send(index < 0 ? 201 : 200, { destination });
      }
      const match = rest!.match(/^\/rules\/([^/]+)(\/mute)?$/);
      const rule = rules.find(
        (r) => r.id === match?.[1] && r.serverId === serverId,
      );
      if (rest === "/mute" || match?.[2]) {
        const mute = scoutMuteSchema.parse(input),
          target = match ? rule : settings.get(serverId!);
        if (!target) return fail();
        target.mutedUntil = mute.durationSeconds
          ? new Date(Date.now() + mute.durationSeconds * 1000).toISOString()
          : null;
        target.muteReason = mute.reason;
        return send(200, target);
      }
      if (request.method === "DELETE") {
        if (!rule) return fail();
        rules.splice(rules.indexOf(rule), 1);
        return send(204);
      }
      const draft = scoutAlertRuleSchema.parse(input);
      if (rule) Object.assign(rule, draft);
      else if (rest === "/rules")
        rules.push({
          ...draft,
          id: randomUUID(),
          serverId: serverId!,
          mutedUntil: null,
          muteReason: "",
          evaluatedAt: null as unknown as string,
          observedValue: null as unknown as number,
          evaluationState: "unknown",
        });
      else return fail();
      send(rule ? 200 : 201, { rule: rule ?? rules.at(-1) });
    })().catch((error) =>
      send(400, {
        error: {
          message: error instanceof Error ? error.message : "Invalid request",
        },
      }),
    );
    return true;
  };
}
