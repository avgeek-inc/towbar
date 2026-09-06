import type {
  MonitoringAgentStatus,
  MonitoringHistory,
  MonitoringAggregates,
} from "@workspace/towbar-web-client";

export function fixtureMonitoringAgent(enabled = true): MonitoringAgentStatus {
  return {
    status: enabled ? "online" : "disabled",
    desiredState: enabled ? "enabled" : "disabled",
    retentionDays: 15,
    version: enabled ? "1.0.0" : null,
    lastCollectedAt: enabled ? new Date().toISOString() : null,
    lastReportAt: enabled ? new Date().toISOString() : null,
    diagnostics: enabled
      ? { collectionDurationMs: 48, collectionErrors: 0, droppedSamples: 0 }
      : null,
    errorMessage: null,
    sampleIntervalSeconds: 30,
    removingServer: false,
  };
}
export function fixtureMonitoringHistory(
  agent: MonitoringAgentStatus,
  serverId: string,
  query: URLSearchParams,
  workload: boolean,
): MonitoringHistory {
  const range = query.get("range") ?? "1h";
  const seconds =
    (
      {
        "1h": 3600,
        "6h": 21600,
        "24h": 86400,
        "7d": 604800,
        "15d": 1296000,
        "30d": 2592000,
        "60d": 5184000,
      } as Record<string, number>
    )[range] ?? 3600;
  const step = Math.max(
    30,
    Math.ceil(Math.min(seconds, agent.retentionDays * 86400) / 180 / 30) * 30,
  );
  const duration = Math.min(seconds, agent.retentionDays * 86400);
  const intervals = Math.ceil(duration / step);
  const end = Math.floor(Date.now() / step / 1000) * step * 1000;
  const start = end - duration * 1000;
  const preview = query.get("environment") === "preview";
  const id = "a".repeat(64);
  const points = Array.from({ length: intervals }, (_, bucket) => {
    const index = (bucket / intervals) * 180;
    const pulse = Math.exp(-((index - 118) ** 2) / 80) * 47;
    const cpu = Math.max(
      0,
      18 + Math.sin(index / 11) * 7 + Math.sin(index / 2) * 2 + pulse,
    );
    const memory = 32 + Math.sin(index / 28) * 4 + pulse * 0.25;
    const values = {
      cpuPercent: cpu,
      cpuCores: cpu / 100,
      memoryPercent: memory,
      memoryUsedBytes: (memory / 100) * 8 * 1024 ** 3,
      memoryTotalBytes: 8 * 1024 ** 3,
      memoryLimitBytes: 8 * 1024 ** 3,
      diskPercent: 42 + index / 70,
      networkRxBytesPerSecond: (24 + cpu) * 1024,
      networkTxBytesPerSecond: (5 + cpu / 3) * 1024,
      diskReadBytesPerSecond: cpu * 3000,
      diskWriteBytesPerSecond: cpu * 1500,
      load1: cpu / 100,
      restartCount: index < 120 ? 0 : 1,
    };
    return {
      at: new Date(start + bucket * step * 1000).toISOString(),
      metrics: Object.fromEntries(
        Object.entries(values).map(([key, value]) => [
          key,
          { sum: value * 2, count: 2, min: value * 0.9, max: value * 1.1 },
        ]),
      ) as MonitoringAggregates,
    };
  }).filter((_, bucket) => {
    const index = (bucket / intervals) * 180;
    return index < 65 || index > 74;
  });
  return {
    agent: {
      ...agent,
      ...(agent.status === "online"
        ? {
            lastReportAt: new Date().toISOString(),
            lastCollectedAt: new Date().toISOString(),
          }
        : {}),
    },
    serverId,
    range,
    startAt: new Date(start).toISOString(),
    endAt: new Date(end).toISOString(),
    stepSeconds: step,
    series: agent.version
      ? [
          {
            id: workload ? id : "host",
            deploymentId: workload
              ? "61111111-1111-4111-8111-111111111111"
              : null,
            previewId: preview ? "b1111111-1111-4111-8111-111111111111" : null,
            points,
          },
        ]
      : [],
    seriesLimited: false,
    eventsLimited: false,
    events: agent.version
      ? [
          {
            id: "61111111-1111-4111-8111-111111111111",
            at: new Date(
              start + Math.floor((intervals * 116) / 180) * step * 1000,
            ).toISOString(),
            type: "deployment",
            state: "succeeded",
          },
          {
            id,
            at: new Date(
              start + Math.floor((intervals * 120) / 180) * step * 1000,
            ).toISOString(),
            type: "restart",
            state: "restarted",
          },
        ]
      : [],
  };
}

export function fixtureServerMonitoringSummary(
  agent: MonitoringAgentStatus,
  serverId: string,
) {
  const end = new Date().toISOString();
  const start = new Date(Date.parse(end) - 30 * 60_000).toISOString();
  const history = fixtureMonitoringHistory(
    agent,
    serverId,
    new URLSearchParams("range=1h"),
    false,
  );
  return {
    enabled: agent.desiredState === "enabled",
    status: agent.status,
    lastCollectedAt: agent.lastCollectedAt,
    start,
    end,
    points:
      agent.desiredState !== "enabled" || agent.status !== "online"
        ? []
        : (history.series[0]?.points ?? [])
            .filter((point) => point.at > start && point.at <= end)
            .slice(-60)
            .map((point) => ({
              at: point.at,
              cpuPercent: point.metrics.cpuPercent
                ? point.metrics.cpuPercent.sum / point.metrics.cpuPercent.count
                : null,
              memoryPercent: point.metrics.memoryPercent
                ? point.metrics.memoryPercent.sum /
                  point.metrics.memoryPercent.count
                : null,
            })),
  };
}
