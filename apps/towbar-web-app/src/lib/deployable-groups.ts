import type { App, Resource } from "@workspace/towbar-web-client";

type Deployable = Pick<
  App | Resource,
  "id" | "entityId" | "sourceId" | "manifestId"
> & { environment: { name: string } | null };

export function groupDeployableInstances<T extends Deployable>(items: T[]) {
  const groups = new Map<
    string,
    { key: string; manifestId: string; items: T[] }
  >();
  for (const item of items) {
    const key = `${item.sourceId}:${item.entityId ?? item.id}`;
    const group = groups.get(key) ?? {
      key,
      manifestId: item.manifestId,
      items: [],
    };
    group.items.push(item);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    group.items.sort(
      (a, b) =>
        (a.environment?.name ?? "").localeCompare(b.environment?.name ?? "") ||
        a.id.localeCompare(b.id),
    );
  }
  return [...groups.values()];
}
