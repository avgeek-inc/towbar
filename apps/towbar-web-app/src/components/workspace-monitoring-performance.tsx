"use client";
import { ScoutIcon } from "./scout-icons";
import { useMonitoringSelection } from "@/hooks/use-monitoring-selection";
import { Analytics01Icon } from "@hugeicons/core-free-icons";
import { PageSelectionTitle } from "./page-selection-title";
import { DashboardPage } from "./page-parts";
import { MonitoringEntityPicker } from "./monitoring-entity-picker";
import { MonitoringHistory } from "./monitoring-history";

export function WorkspacePerformance() {
  const {
    kind,
    setKind,
    selected,
    select: setSelected,
    entityKey,
    resolve,
  } = useMonitoringSelection();
  return (
    <DashboardPage
      title={selected?.name ?? "Performance"}
      breadcrumbLabel="Performance"
      icon={Analytics01Icon}
    >
      {selected ? (
        <PageSelectionTitle
          label={selected.name}
          icon={<ScoutIcon name={selected.kind} />}
        />
      ) : null}
      <div className="grid min-w-0 gap-6">
        <MonitoringEntityPicker
          kind={kind}
          entityKey={entityKey}
          onResolve={resolve}
          onKindChange={setKind}
          selected={selected}
          onSelect={setSelected}
        />
        {selected && (kind === "all" || selected.kind === kind) ? (
          <MonitoringHistory
            key={selected.key}
            path={`/v1/core/${selected.kind === "server" ? "servers" : selected.kind === "app" ? "apps" : "resources"}/${selected.id}/metrics`}
            serverId={selected.serverId}
            workload={selected.kind !== "server"}
          />
        ) : null}
      </div>
    </DashboardPage>
  );
}
