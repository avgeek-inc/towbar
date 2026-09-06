"use client";

import dynamic from "next/dynamic";
import { usePathname, useSearchParams } from "next/navigation";
import { Tabs } from "@workspace/web-design-system/navigation/tabs";
import { QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { useApiQuery } from "@/hooks/use-api-query";
import { MonitoringHistory } from "./monitoring-history";
import { ScoutAlerts } from "./scout-alerts";
import {
  SourceNotifications,
  type NotificationDestinationsResponse,
} from "./source-notifications";

const ScoutComparison = dynamic(
  () => import("./scout-comparison").then((m) => m.ScoutComparison),
  { loading: () => <QueryLoading /> },
);

export function ScoutPanel({
  path,
  serverId,
  deployableId,
}: {
  path: string;
  serverId: string;
  deployableId?: string;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const tabs = [
    { id: "performance", label: "Performance" },
    { id: "alerts", label: "Alerts" },
    ...(deployableId
      ? [{ id: "compare", label: "Compare deployments" }]
      : [{ id: "notifications", label: "Notifications" }]),
  ];
  const selected = tabs.some((tab) => tab.id === params.get("scout"))
    ? params.get("scout")!
    : "performance";
  function select(value: string) {
    const next = new URLSearchParams(params.toString());
    if (value === "performance") next.delete("scout");
    else next.set("scout", value);
    window.history.pushState(null, "", `${pathname}?${next}`);
  }
  return (
    <Tabs
      selectedKey={selected}
      onSelectionChange={(key) => select(String(key))}
      className="grid min-w-0 gap-6"
    >
      <Tabs.ListContainer className="min-w-0 max-w-full">
        <Tabs.List aria-label="Scout Agent sections">
          {tabs.map((tab) => (
            <Tabs.Tab
              id={tab.id}
              key={tab.id}
              className="min-w-max whitespace-nowrap"
            >
              {tab.label}
              <Tabs.Indicator />
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs.ListContainer>
      <Tabs.Panel id="performance" className="m-0 min-w-0 p-0 outline-none">
        <MonitoringHistory
          path={path}
          serverId={serverId}
          workload={Boolean(deployableId)}
        />
      </Tabs.Panel>
      <Tabs.Panel id="alerts" className="m-0 min-w-0 p-0 outline-none">
        <ScoutAlerts
          key={deployableId ?? serverId}
          serverId={serverId}
          deployableId={deployableId}
          onViewGraph={() => select("performance")}
        />
      </Tabs.Panel>
      {deployableId ? (
        <Tabs.Panel id="compare" className="m-0 min-w-0 p-0 outline-none">
          <ScoutComparison deployableId={deployableId} />
        </Tabs.Panel>
      ) : (
        <Tabs.Panel id="notifications" className="m-0 min-w-0 p-0 outline-none">
          <ScoutNotifications serverId={serverId} />
        </Tabs.Panel>
      )}
    </Tabs>
  );
}

function ScoutNotifications({ serverId }: { serverId: string }) {
  const destinations = useApiQuery<NotificationDestinationsResponse>(
    `/v1/core/servers/${serverId}/notifications/destinations`,
    30_000,
  );
  return (
    <div className="grid gap-5">
      <div className="grid gap-1">
        <h2 className="text-lg font-medium">Notification destinations</h2>
        <p className="text-sm text-muted">
          Add Slack or email destinations to receive Scout alerts for this
          server and its workloads.
        </p>
      </div>
      <SourceNotifications
        serverId={serverId}
        canManage={destinations.data?.canManageNotifications ?? false}
        destinations={destinations}
      />
    </div>
  );
}
