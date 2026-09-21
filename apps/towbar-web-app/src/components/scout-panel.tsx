import dynamic from "next/dynamic";
import { QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { MonitoringHistory } from "./monitoring-history";
import { ScoutAlerts } from "./scout-alerts";

const ScoutComparison = dynamic(
  () => import("./scout-comparison").then((m) => m.ScoutComparison),
  { loading: () => <QueryLoading /> },
);

export function ScoutPerformance({
  path,
  serverId,
  workload = false,
}: {
  path: string;
  serverId: string;
  workload?: boolean;
}) {
  return (
    <MonitoringHistory path={path} serverId={serverId} workload={workload} />
  );
}

export function ScoutAlertRules({
  serverId,
  deployableId,
}: {
  serverId: string;
  deployableId?: string;
}) {
  return (
    <ScoutAlerts
      key={deployableId ?? serverId}
      serverId={serverId}
      deployableId={deployableId}
      view="alerts"
    />
  );
}

export function ScoutIncidents({
  serverId,
  deployableId,
}: {
  serverId: string;
  deployableId?: string;
}) {
  return (
    <ScoutAlerts
      key={deployableId ?? serverId}
      serverId={serverId}
      deployableId={deployableId}
      view="incidents"
    />
  );
}

export function ScoutCompareDeployments({
  deployableId,
}: {
  deployableId: string;
}) {
  return <ScoutComparison deployableId={deployableId} />;
}
