"use client";

import { Layers01Icon } from "@hugeicons/core-free-icons";
import { usePathname, useRouter } from "next/navigation";
import type { App, Resource } from "@workspace/towbar-web-client";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { useApiQuery } from "@/hooks/use-api-query";
import { ResponsiveChoice } from "./responsive-choice";

export function InstanceEnvironmentChoice({
  item,
  kind,
}: {
  item: App | Resource;
  kind: "apps" | "resources";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const query = useApiQuery<{ apps?: App[]; resources?: Resource[] }>(
    item.entityId ? `/v1/core/sources/${item.sourceId}/${kind}` : null,
  );
  if (!item.entityId || !item.environment) return null;
  if (query.error) return <QueryError message={query.error} />;
  if (!query.data) return <QueryLoading />;
  const instances = (query.data[kind] ?? [])
    .filter(
      (instance) =>
        instance.sourceId === item.sourceId &&
        instance.entityId === item.entityId &&
        instance.environment,
    )
    .sort((left, right) =>
      left.environment!.name.localeCompare(right.environment!.name),
    );
  const base = `/sources/${item.sourceId}/${kind}`;
  const currentBase = `${base}/${item.id}`;
  const section = pathname.startsWith(`${currentBase}/`)
    ? pathname.slice(currentBase.length)
    : "/overview";
  return (
    <ResponsiveChoice
      label="Environment"
      value={item.id}
      options={instances.map((instance) => ({
        value: instance.id,
        label: `${instance.environment!.name}${instance.environment!.disconnectedAt ? " (disconnected)" : ""}`,
        icon: Layers01Icon,
      }))}
      onChange={(id) => {
        if (
          id !== item.id &&
          instances.some((instance) => instance.id === id)
        ) {
          router.push(`${base}/${id}${section}`);
        }
      }}
    />
  );
}
