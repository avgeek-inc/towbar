"use client";
import { useState } from "react";
import { Button } from "@workspace/web-design-system/buttons/button";
import { Chip } from "@workspace/web-design-system/data-display/chip";
import { Widget } from "@workspace/web-design-system/data-display/widget";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import {
  ResourceTable,
  type ResourceTableColumn,
} from "@workspace/towbar-web-ui/resource-table";
import { useApiQuery } from "@/hooks/use-api-query";
import { api } from "@/lib/api";
import { ActionButton } from "./page-parts";
import { formatDate } from "./dashboard-overview";
import { ScoutRuleEditor } from "./scout-rule-editor";
import {
  ScoutSelect,
  conditionDescription,
  scoutValue,
  type ScoutRule,
  type ScoutIncident,
  type ScoutRulesResponse,
} from "./scout-controls";
import { ScoutMuteDialog } from "./scout-mute-dialog";

export function ScoutAlerts({
  serverId,
  deployableId,
  onViewGraph,
}: {
  serverId: string;
  deployableId?: string;
  onViewGraph: () => void;
}) {
  const endpoint = `/v1/core/servers/${serverId}/scout-alerts`;
  const entity = deployableId ?? "server";
  const query = useApiQuery<ScoutRulesResponse>(
    `${endpoint}?deployableId=${entity}`,
    30_000,
  );
  const [editing, setEditing] = useState<ScoutRule | "new" | null>(null);
  const [mute, setMute] = useState<ScoutRule | "server" | null>(null);
  const [state, setState] = useState("active");
  const [cursors, setCursors] = useState<string[]>([""]);
  const cursor = cursors.at(-1)!;
  const incidents = useApiQuery<{
    incidents: ScoutIncident[];
    nextBefore: string | null;
    nextBeforeId: string | null;
  }>(
    `${endpoint}/incidents?state=${state}&limit=10&deployableId=${entity}${cursor}`,
    30_000,
    { keepPreviousData: true },
  );
  const refresh = () => {
    query.refresh();
    incidents.refresh();
  };
  if (!query.data)
    return (
      <Widget>
        <Widget.Content className="min-h-64">
          {query.error ? (
            <QueryError message={query.error} />
          ) : (
            <QueryLoading />
          )}
        </Widget.Content>
      </Widget>
    );
  const data = query.data;
  const muted =
    data.settings.mutedUntil &&
    new Date(data.settings.mutedUntil).getTime() > Date.now();
  const rules = data.rules.filter(
    (r) => r.deployableId === (deployableId ?? null),
  );
  const columns: ResourceTableColumn<ScoutRule>[] = [
    {
      key: "name",
      header: "Rule",
      cell: (r) => (
        <div className="grid gap-1">
          <span className="font-medium">{r.name}</span>
          <span className="text-sm text-muted">
            {conditionDescription(r.condition)}
          </span>
          <span className="text-xs text-muted">
            {r.deployableId
              ? (data.workloads.find((w) => w.id === r.deployableId)?.name ??
                "Workload")
              : "Server"}
            {r.deployableId
              ? ` · ${r.environment === "preview" ? "Previews" : "Production"}`
              : ""}
          </span>
        </div>
      ),
      className: "min-w-72",
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => (
        <div className="grid justify-items-start gap-1">
          <Chip
            size="small"
            variant={
              !r.enabled ||
              (r.mutedUntil && new Date(r.mutedUntil).getTime() > Date.now())
                ? "secondary"
                : r.evaluationState === "firing"
                  ? "destructive"
                  : r.evaluationState === "healthy"
                    ? "success"
                    : "secondary"
            }
          >
            {!r.enabled
              ? "Paused"
              : r.mutedUntil && new Date(r.mutedUntil).getTime() > Date.now()
                ? "Muted"
                : ({
                    healthy: "Healthy",
                    firing: "Alerting",
                    pending: "Evaluating",
                    unknown: "No recent data",
                    inactive: "Scout inactive",
                    error: "Evaluation error",
                  }[r.evaluationState] ?? "Evaluating")}
          </Chip>
          <span className="text-xs text-muted">
            {r.severity === "critical" ? "Critical" : "Warning"}
          </span>
        </div>
      ),
    },
    {
      key: "reading",
      header: "Latest reading",
      cell: (r) => (
        <span className="tabular-nums">
          {scoutValue(r.observedValue, r.condition.metric)}
          {r.httpCheck ? (
            <span className="block text-xs text-muted">
              {r.httpCheck.reason ??
                (r.httpCheck.status_code
                  ? `HTTP ${r.httpCheck.status_code} · ${r.httpCheck.latency_ms} ms`
                  : "Checking…")}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      cell: (r) =>
        data.canManage ? (
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onPress={() => setEditing(r)}>
              Edit
            </Button>
            <Button variant="secondary" size="sm" onPress={() => setMute(r)}>
              Mute
            </Button>
            <ActionButton
              variant="secondary"
              action={() => api.delete(`${endpoint}/rules/${r.id}`)}
              onSuccess={refresh}
              confirm={{
                title: `Delete ${r.name}?`,
                description:
                  "Stops this rule. Existing incidents remain in history.",
                actionLabel: "Delete rule",
              }}
              success="Rule deleted"
            >
              Delete
            </ActionButton>
          </div>
        ) : null,
    },
  ];
  const incidentColumns: ResourceTableColumn<ScoutIncident>[] = [
    {
      key: "rule",
      header: "Incident",
      cell: (i) => (
        <div className="grid gap-1">
          <span className="font-medium">{i.ruleName}</span>
          <span className="text-sm text-muted">
            {conditionDescription(i.condition)}
          </span>
        </div>
      ),
      className: "min-w-64",
    },
    {
      key: "state",
      header: "Status",
      cell: (i) => (
        <Chip
          size="small"
          variant={
            i.resolvedAt
              ? "secondary"
              : i.severity === "critical"
                ? "destructive"
                : "warning"
          }
        >
          {i.resolvedAt
            ? i.resolutionReason === "recovered"
              ? "Recovered"
              : "Closed"
            : i.severity === "critical"
              ? "Critical"
              : "Warning"}
        </Chip>
      ),
    },
    { key: "started", header: "Started", cell: (i) => formatDate(i.openedAt) },
    {
      key: "resolved",
      header: "Ended",
      cell: (i) =>
        i.resolvedAt ? (
          <div className="grid gap-1">
            <span>{formatDate(i.resolvedAt)}</span>
            <span className="text-xs text-muted">
              {i.resolutionReason?.replaceAll("_", " ")}
            </span>
          </div>
        ) : (
          "Ongoing"
        ),
    },
    {
      key: "reading",
      header: "Reading",
      cell: (i) => scoutValue(i.lastValue, i.condition.metric),
    },
    {
      key: "graph",
      header: "",
      cell: (incident) =>
        incident.condition.metric === "httpAvailability" ? null : (
          <Button variant="secondary" size="sm" onPress={onViewGraph}>
            View graph
          </Button>
        ),
    },
  ];
  return (
    <div className="grid min-w-0 gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-1">
          <h2 className="text-lg font-medium">Scout Alerts</h2>
          <p className="max-w-2xl text-sm text-muted">
            Get notified when sustained pressure or missing reports need
            attention.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {data.canManage ? (
            <>
              {!deployableId ? (
                <Button variant="secondary" onPress={() => setMute("server")}>
                  {muted ? "Manage mute" : "Mute for maintenance"}
                </Button>
              ) : null}
              <Button onPress={() => setEditing("new")}>Create rule</Button>
            </>
          ) : null}
        </div>
      </div>
      {query.error ? <QueryError message={query.error} /> : null}
      {muted ? (
        <div role="status" className="rounded-xl bg-default p-4 text-sm">
          Notifications muted until {formatDate(data.settings.mutedUntil!)}
          {data.settings.muteReason ? ` · ${data.settings.muteReason}` : ""}.
          Scout continues recording incidents.
        </div>
      ) : null}
      <ResourceTable
        ariaLabel="Scout alert rules"
        columns={columns}
        getRowKey={(r) => r.id}
        items={rules}
        emptyTitle="No alert rules yet"
        emptyDescription="Start with a CPU, memory, disk, restart, or missing-report preset. Rules are enabled only when you create them."
      />
      <section className="grid min-w-0 gap-4" aria-label="Scout incidents">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 className="text-lg font-medium">Incidents</h2>
          <div className="w-44">
            <ScoutSelect
              label="Show incidents"
              value={state}
              onChange={(value) => {
                setState(value);
                setCursors([""]);
              }}
              options={[
                { id: "active", label: "Active" },
                { id: "resolved", label: "Resolved" },
                { id: "all", label: "All incidents" },
              ]}
            />
          </div>
        </div>
        {incidents.error ? <QueryError message={incidents.error} /> : null}
        {incidents.data ? (
          <ResourceTable
            ariaLabel="Scout incidents"
            columns={incidentColumns}
            getRowKey={(i) => i.id}
            items={incidents.data.incidents}
            emptyTitle={
              state === "active"
                ? "No active incidents"
                : "No incidents in this view"
            }
            emptyDescription={
              state === "active"
                ? "Incidents appear here when an enabled rule meets its alert condition."
                : "History follows this server’s Scout retention setting."
            }
          />
        ) : (
          <QueryLoading />
        )}
        <div className="flex items-center justify-end gap-3">
          <span className="text-sm text-muted">Page {cursors.length}</span>
          <Button
            variant="secondary"
            size="sm"
            isDisabled={cursors.length === 1 || incidents.isPreviousData}
            onPress={() => setCursors((old) => old.slice(0, -1))}
          >
            Previous
          </Button>
          <Button
            variant="secondary"
            size="sm"
            isDisabled={!incidents.data?.nextBefore || incidents.isPreviousData}
            onPress={() =>
              setCursors((old) => [
                ...old,
                `&before=${encodeURIComponent(incidents.data!.nextBefore!)}&beforeId=${incidents.data!.nextBeforeId}`,
              ])
            }
          >
            Next
          </Button>
        </div>
      </section>
      {editing ? (
        <ScoutRuleEditor
          serverId={serverId}
          initial={editing === "new" ? undefined : editing}
          deployableId={deployableId}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      ) : null}
      {mute ? (
        <ScoutMuteDialog
          endpoint={
            mute === "server"
              ? `${endpoint}/mute`
              : `${endpoint}/rules/${mute.id}/mute`
          }
          title={mute === "server" ? "Mute server alerts" : `Mute ${mute.name}`}
          mutedUntil={
            mute === "server" ? data.settings.mutedUntil : mute.mutedUntil
          }
          onClose={() => setMute(null)}
          onSaved={refresh}
        />
      ) : null}
    </div>
  );
}
