"use client";

import { usePathname, useRouter } from "next/navigation";
import type { App, Resource } from "@workspace/towbar-web-client";
import { ListBox } from "@workspace/web-design-system/collections/list-box";
import { Select } from "@workspace/web-design-system/forms/select";
import { useApiQuery } from "@/hooks/use-api-query";
import { SecondarySection } from "./secondary-sidebar";
import { EnvironmentIcon } from "./environment-icon";

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
  if (query.error)
    return (
      <SecondarySection className="order-[-1]" title="Environment">
        <p className="px-2 text-xs text-danger">{query.error}</p>
      </SecondarySection>
    );
  if (!query.data) return null;
  const instances = (query.data[kind] ?? [])
    .flatMap((instance) => {
      const environment = instance.environment;
      return instance.sourceId === item.sourceId &&
        instance.entityId === item.entityId &&
        environment
        ? [{ id: instance.id, environment }]
        : [];
    })
    .sort((left, right) =>
      left.environment.name.localeCompare(right.environment.name),
    );
  const base = `/${kind}`;
  const currentBase = `${base}/${item.id}`;
  const section = pathname.startsWith(`${currentBase}/`)
    ? pathname.slice(currentBase.length)
    : "/overview";
  return (
    <SecondarySection className="order-[-1]" title="Environment">
      <div>
        <Select
          aria-label="Environment"
          fullWidth
          selectedKey={item.id}
          variant="secondary"
          onSelectionChange={(key) => {
            const id = String(key ?? "");
            if (
              id !== item.id &&
              instances.some((instance) => instance.id === id)
            ) {
              router.push(`${base}/${id}${section}`);
            }
          }}
        >
          <Select.Trigger>
            <Select.Value className="flex min-w-0 flex-1 items-center overflow-hidden">
              <span className="flex min-w-0 items-center gap-2">
                <EnvironmentIcon name={item.environment.name} />
                <span className="truncate">
                  {item.environment.name}
                  {item.environment.disconnectedAt ? " (disconnected)" : ""}
                </span>
              </span>
            </Select.Value>
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {instances.map((instance) => {
                const label = `${instance.environment.name}${instance.environment.disconnectedAt ? " (disconnected)" : ""}`;
                return (
                  <ListBox.Item
                    id={instance.id}
                    key={instance.id}
                    textValue={label}
                  >
                    <EnvironmentIcon name={instance.environment.name} />
                    <span className="min-w-0 flex-1 truncate">{label}</span>
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                );
              })}
            </ListBox>
          </Select.Popover>
        </Select>
      </div>
    </SecondarySection>
  );
}
