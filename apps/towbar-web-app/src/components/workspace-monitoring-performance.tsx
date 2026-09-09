"use client";
import { useState } from "react";
import { Analytics01Icon } from "@hugeicons/core-free-icons";
import { DashboardPage } from "./page-parts";
import { MonitoringEntityPicker } from "./monitoring-entity-picker";
import { MonitoringHistory } from "./monitoring-history";
import type { MonitoringEntity } from "./workspace-monitoring-shared";

export function WorkspacePerformance() {
  const [kind, setKind] = useState("all");
  const [selected, setSelected] = useState<MonitoringEntity | null>(null);
  return (
    <DashboardPage
      title={selected?.name ?? "Performance"}
      breadcrumbLabel="Performance"
      icon={Analytics01Icon}
    >
      <div className="grid min-w-0 gap-6">
        <MonitoringEntityPicker
          kind={kind}
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
