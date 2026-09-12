import type { App, Resource } from "@workspace/towbar-web-client";

type InventoryItem = Pick<
  App | Resource,
  "sourceId" | "serverIp" | "archivedAt"
> & { entityId?: string | null };

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
    const counted = new Set<unknown>();
    for (const item of items) {
      if (item.archivedAt) continue;
      const count = counts.get(item.sourceId) ?? {
        apps: 0,
        resources: 0,
        servers: new Set<string>(),
      };
      const key = item.entityId ? `${item.sourceId}:${item.entityId}` : item;
      if (!counted.has(key)) count[kind] += 1;
      counted.add(key);
      count.servers.add(item.serverIp);
      counts.set(item.sourceId, count);
    }
  }
  return counts;
}
