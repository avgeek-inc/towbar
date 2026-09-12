"use client";

import { DashboardCircleIcon, DatabaseIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { App, Resource } from "@workspace/towbar-web-client";
import { ResourceTable } from "@workspace/towbar-web-ui/resource-table";
import { groupDeployableInstances } from "@/lib/deployable-groups";

export function DeployableInventoryTable<T extends App | Resource>({
  items,
  ...props
}: Parameters<typeof ResourceTable<T>>[0]) {
  if (items.length === 0) return <ResourceTable {...props} items={items} />;
  return (
    <div className="grid gap-6">
      {groupDeployableInstances(items).map((group) => (
        <section
          className="grid min-w-0 gap-3"
          key={group.key}
          aria-label={group.manifestId}
        >
          <div className="flex min-w-0 items-center gap-2">
            <HugeiconsIcon
              aria-hidden="true"
              className="size-5 shrink-0"
              icon={
                group.items[0]!.kind === "app"
                  ? DashboardCircleIcon
                  : DatabaseIcon
              }
            />
            <h2 className="truncate text-base" title={group.manifestId}>
              {group.manifestId}
            </h2>
            <span className="shrink-0 text-xs text-muted">
              {group.items.length}{" "}
              {group.items.length === 1 ? "environment" : "environments"}
            </span>
          </div>
          <ResourceTable
            {...props}
            ariaLabel={`${props.ariaLabel}: ${group.manifestId}`}
            items={group.items}
          />
        </section>
      ))}
    </div>
  );
}
