"use client";

import { useState } from "react";
import type { MonitoringAgentStatus } from "@workspace/towbar-web-client";
import { Widget } from "@workspace/web-design-system/data-display/widget";
import { Chip } from "@workspace/web-design-system/data-display/chip";
import { Checkbox } from "@workspace/web-design-system/forms/checkbox";
import { Label } from "@workspace/web-design-system/forms/label";
import { ListBox, Select } from "@workspace/web-design-system/forms/select";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { ScoutIcon } from "./scout-icons";
import { ScoutMascot } from "./scout-mascot";
import { MonitoringDocumentation } from "./monitoring-documentation";
import { ActionButton } from "./page-parts";
import { useApiQuery } from "@/hooks/use-api-query";
import { api } from "@/lib/api";
import { formatDate } from "./dashboard-overview";

export function MonitoringAgentSettings({
  serverId,
  canManage,
  ready,
}: {
  serverId: string;
  canManage: boolean;
  ready: boolean;
}) {
  const query = useApiQuery<{ agent: MonitoringAgentStatus }>(
    `/v1/core/servers/${serverId}/monitoring`,
    5000,
  );
  if (query.error) return <QueryError message={query.error} />;
  if (!query.data) return <QueryLoading />;
  return (
    <MonitoringAgentForm
      agent={query.data.agent}
      serverId={serverId}
      canManage={canManage}
      ready={ready}
    />
  );
}
function MonitoringAgentForm({
  agent,
  serverId,
  canManage,
  ready,
}: {
  agent: MonitoringAgentStatus;
  serverId: string;
  canManage: boolean;
  ready: boolean;
}) {
  const [retention, setRetention] = useState<number | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const days = retention ?? agent.retentionDays;
  const busy =
    ["queued", "installing", "uninstalling"].includes(agent.status) ||
    agent.removingServer;
  const installed = agent.desiredState === "enabled";
  const endpoint = `/v1/core/servers/${serverId}/monitoring`;
  return (
    <div className="content-grid">
      <Widget>
        <Widget.Header endContent={<MonitoringStatus agent={agent} />}>
          <Widget.Title>Scout Agent</Widget.Title>
        </Widget.Header>
        <Widget.Content className="grid gap-5">
          <div className="flex items-center gap-4">
            <ScoutMascot />
            <div className="grid min-w-0 gap-2">
              <p className="font-medium">
                {installed
                  ? "Scout Agent, your monitoring agent."
                  : "Install Scout Agent for advanced monitoring."}
              </p>
              <p className="max-w-3xl text-sm text-muted">
                See how this server and its apps and resources perform over
                time, with updates every 30 seconds.
              </p>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-4 text-sm lg:grid-cols-3">
            <div>
              <dt className="text-muted">Scout Agent version</dt>
              <dd className="mt-0.5 tabular-nums">
                {agent.version ?? "Not installed"}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Last sample</dt>
              <dd className="mt-0.5 tabular-nums">
                {agent.lastCollectedAt
                  ? formatDate(agent.lastCollectedAt)
                  : "Waiting for a report"}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Reporting interval</dt>
              <dd className="mt-0.5">30 seconds</dd>
            </div>
          </dl>
          {busy ? (
            <p role="status" className="text-sm text-muted">
              {agent.removingServer
                ? "Removing Scout Agent before removing this server…"
                : agent.status === "uninstalling"
                  ? "Stopping and removing Scout Agent…"
                  : agent.status === "installing"
                    ? "Installing services and checking startup…"
                    : "Waiting for the worker…"}
            </p>
          ) : null}
          {agent.status === "waiting" ? (
            <p role="status" className="text-sm text-muted">
              Scout Agent is installed. Waiting for the first report.
            </p>
          ) : null}
          {agent.errorMessage ? (
            <QueryError message={agent.errorMessage} />
          ) : null}
          {agent.diagnostics &&
          (agent.diagnostics.collectionErrors > 0 ||
            agent.diagnostics.droppedSamples > 0) ? (
            <p className="text-sm text-warning">
              Last collection: {agent.diagnostics.collectionErrors} unavailable
              checks. {agent.diagnostics.droppedSamples} buffered samples
              dropped. Missing measurements appear as gaps.
            </p>
          ) : null}
          <div className="grid max-w-sm gap-2">
            <Select
              selectedKey={String(days)}
              onSelectionChange={(value) => {
                if (value) setRetention(Number(value));
              }}
              isDisabled={!canManage || busy}
              variant="secondary"
              fullWidth
            >
              <Label>Data retention</Label>
              <Select.Trigger>
                <Select.Value className="flex min-w-0 items-center" />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {[7, 15, 30, 60].map((value) => (
                    <ListBox.Item
                      id={String(value)}
                      key={value}
                      textValue={`${value} days`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <ScoutIcon name="date" />
                        {value} days{value === 15 ? " (default)" : ""}
                      </span>
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
            <p className="text-xs text-muted">
              Choose how long to keep performance history. Reducing this period
              removes older data.
            </p>
          </div>
          {canManage && days !== agent.retentionDays ? (
            <div>
              <ActionButton
                action={() => api.patch(endpoint, { retentionDays: days })}
                onSuccess={() => setRetention(null)}
                isDisabled={busy}
                success="Retention updated"
              >
                <ScoutIcon name="save" />
                Save retention
              </ActionButton>
            </div>
          ) : null}
          {canManage && !installed && !busy ? (
            <Checkbox isSelected={acknowledged} onChange={setAcknowledged}>
              <Checkbox.Content>
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
                <Label>
                  Allow Towbar to install Scout Agent and collect performance
                  data.
                </Label>
              </Checkbox.Content>
            </Checkbox>
          ) : null}
          {canManage ? (
            <div className="flex flex-wrap gap-2">
              <ActionButton
                action={() =>
                  api.post(`${endpoint}/actions/install`, {
                    acknowledge: true,
                    retentionDays: days,
                  })
                }
                isDisabled={busy || !ready || (!installed && !acknowledged)}
                confirm={
                  installed
                    ? {
                        title: "Update Scout Agent?",
                        description:
                          "Install the latest version of Scout Agent. Reporting may pause briefly.",
                        actionLabel: "Update Scout Agent",
                      }
                    : undefined
                }
                onSuccess={() => {
                  setAcknowledged(false);
                  setRetention(null);
                }}
                success="Scout Agent installation queued"
                pendingLabel="Queuing…"
                variant="primary"
              >
                <ScoutIcon name={installed ? "refresh" : "install"} />
                {installed ? "Update Scout Agent" : "Install Scout Agent"}
              </ActionButton>
              {installed || agent.status === "failed" ? (
                <ActionButton
                  action={() => api.post(`${endpoint}/actions/uninstall`)}
                  isDisabled={busy}
                  confirm={{
                    title: "Uninstall Scout Agent?",
                    description:
                      "Stop monitoring and remove Scout Agent. Existing history is kept for your selected retention period.",
                    actionLabel: "Uninstall Scout Agent",
                  }}
                  success="Scout Agent removal queued"
                  pendingLabel="Queuing…"
                >
                  <ScoutIcon name="delete" />
                  Uninstall Scout Agent
                </ActionButton>
              ) : null}
            </div>
          ) : null}
          <div>
            <MonitoringDocumentation />
          </div>
          {!ready && !installed ? (
            <p className="text-sm text-muted">
              Prepare this server before installing Scout Agent.
            </p>
          ) : null}
        </Widget.Content>
      </Widget>
    </div>
  );
}
export function MonitoringStatus({ agent }: { agent: MonitoringAgentStatus }) {
  const labels: Record<string, string> = {
    disabled: "Not enabled",
    queued: "Queued",
    installing: "Installing",
    waiting: "Awaiting report",
    online: "Online",
    offline: "No recent report",
    uninstalling: "Uninstalling",
    failed: "Needs attention",
  };
  return (
    <Chip
      size="small"
      variant={
        agent.status === "online"
          ? "success"
          : ["offline", "failed"].includes(agent.status)
            ? "warning"
            : "secondary"
      }
    >
      {labels[agent.status] ?? agent.status}
    </Chip>
  );
}
