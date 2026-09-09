import { z } from "zod";

const base = z.object({
  q: z.string().trim().max(200).optional(),
  view: z.enum(["all", "attention"]).default("all"),
});
export const workloadFilters = base
  .extend({
    sourceId: z.uuid().optional(),
    serverIp: z.string().max(100).optional(),
    resourceType: z.enum(["image", "postgres", "redis"]).optional(),
    running: z.enum(["running", "stopped", "missing", "unknown"]).optional(),
    health: z
      .enum(["healthy", "unhealthy", "starting", "none", "unknown"])
      .optional(),
  })
  .strict();
export const serverFilters = base
  .extend({
    setup: z.enum(["ready", "pending", "preparing", "failed"]).optional(),
    health: z.enum(["healthy", "unhealthy", "unknown"]).optional(),
    scout: z
      .enum([
        "online",
        "offline",
        "disabled",
        "queued",
        "installing",
        "uninstalling",
        "waiting",
        "failed",
      ])
      .optional(),
  })
  .strict();
export const sourceFilters = base
  .extend({
    sync: z
      .enum(["never", "queued", "running", "succeeded", "failed"])
      .optional(),
    autoDeploy: z.enum(["enabled", "paused"]).optional(),
  })
  .strict();

type Base = z.output<typeof base>;
function select<T>(
  items: T[],
  query: Base,
  attention: (item: T) => boolean,
  matches: (item: T) => boolean,
) {
  return {
    items: items.filter(
      (item) =>
        (query.view !== "attention" || attention(item)) && matches(item),
    ),
    counts: { all: items.length, attention: items.filter(attention).length },
  };
}
const includes = (text: string, q?: string) =>
  !q || text.toLowerCase().includes(q.toLowerCase());
export function filterWorkloads<
  T extends {
    name: string;
    sourceId: string;
    serverIp: string;
    kind: string;
    serverReady: boolean;
    runtimeState: {
      healthStatus: string;
      observedState: string;
      desiredState: string;
      driftStatus: string;
    };
  },
>(items: T[], query: z.output<typeof workloadFilters>) {
  return select(
    items,
    query,
    (item) =>
      !item.serverReady ||
      item.runtimeState.healthStatus === "unhealthy" ||
      item.runtimeState.driftStatus === "drifted" ||
      (item.runtimeState.desiredState === "running" &&
        ["stopped", "missing"].includes(item.runtimeState.observedState)),
    (item) =>
      includes(`${item.name} ${item.serverIp}`, query.q) &&
      (!query.sourceId || item.sourceId === query.sourceId) &&
      (!query.serverIp || item.serverIp === query.serverIp) &&
      (!query.resourceType || item.kind === query.resourceType) &&
      (!query.running || item.runtimeState.observedState === query.running) &&
      (!query.health || item.runtimeState.healthStatus === query.health),
  );
}
export function filterServers<
  T extends {
    canonicalIp: string;
    setupStatus: string;
    healthStatus?: string;
    scout?: { enabled: boolean; status: string };
  },
>(items: T[], query: z.output<typeof serverFilters>) {
  const scoutState = (item: T) =>
    !item.scout?.enabled &&
    !["queued", "uninstalling", "failed"].includes(
      item.scout?.status ?? "disabled",
    )
      ? "disabled"
      : (item.scout?.status ?? "disabled");
  return select(
    items,
    query,
    (item) =>
      item.setupStatus === "failed" ||
      item.setupStatus === "pending" ||
      item.healthStatus === "unhealthy" ||
      ["offline", "failed"].includes(scoutState(item)),
    (item) =>
      includes(item.canonicalIp, query.q) &&
      (!query.setup || item.setupStatus === query.setup) &&
      (!query.health || (item.healthStatus ?? "unknown") === query.health) &&
      (!query.scout || scoutState(item) === query.scout),
  );
}
export function filterSources<
  T extends {
    repositoryOwner: string;
    repositoryName: string;
    latestSyncStatus?: string;
    autoDeployPaused?: boolean;
  },
>(items: T[], query: z.output<typeof sourceFilters>) {
  return select(
    items,
    query,
    (item) => item.latestSyncStatus === "failed",
    (item) =>
      includes(`${item.repositoryOwner}/${item.repositoryName}`, query.q) &&
      (!query.sync || (item.latestSyncStatus ?? "never") === query.sync) &&
      (!query.autoDeploy ||
        Boolean(item.autoDeployPaused) === (query.autoDeploy === "paused")),
  );
}
