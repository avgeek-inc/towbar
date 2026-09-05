import type { App, Resource } from "@workspace/towbar-web-client";

type InventoryItem = Pick<
  App | Resource,
  "sourceId" | "serverIp" | "archivedAt"
>;

export function countSourceInventory(
  apps: InventoryItem[],
  resources: InventoryItem[],
) {
  const counts = new Map<
    string,
    { apps: number; resources: number; servers: Set<string> }
  >();
  for (const [kind, items] of [
    ["apps", apps],
    ["resources", resources],
  ] as const) {
    for (const item of items) {
      if (item.archivedAt) continue;
      const count = counts.get(item.sourceId) ?? {
        apps: 0,
        resources: 0,
        servers: new Set<string>(),
      };
      count[kind] += 1;
      count.servers.add(item.serverIp);
      counts.set(item.sourceId, count);
    }
  }
  return counts;
}
