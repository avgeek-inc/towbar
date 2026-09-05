"use client";

import { useState } from "react";
import type { MonitoringAgentStatus } from "@workspace/towbar-web-client";
import { Widget } from "@workspace/web-design-system/data-display/widget";
import { Chip } from "@workspace/web-design-system/data-display/chip";
import { Checkbox } from "@workspace/web-design-system/forms/checkbox";
import { Label } from "@workspace/web-design-system/forms/label";
import { ListBox, Select } from "@workspace/web-design-system/forms/select";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
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
          <Widget.Title>Monitoring Agent</Widget.Title>
        </Widget.Header>
        <Widget.Content className="grid gap-5">
          <div className="grid gap-2">
            <p>
              Collect CPU, memory, disk, and network metrics for this server and
              its apps and resources every 30 seconds.
            </p>
            <p className="max-w-3xl text-sm text-muted">
              Towbar installs a small service that starts automatically after a
              reboot. It sends metrics over HTTPS, uses a bounded retry buffer
              during outages, and requires no inbound port.
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-4 text-sm lg:grid-cols-3">
            <div>
              <dt className="text-muted">Agent version</dt>
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
                ? "Removing the agent before removing this server…"
                : agent.status === "uninstalling"
                  ? "Stopping and removing the agent…"
                  : agent.status === "installing"
                    ? "Installing services and checking startup…"
                    : "Waiting for the worker…"}
            </p>
          ) : null}
          {agent.status === "waiting" ? (
            <p role="status" className="text-sm text-muted">
              Installation completed. Waiting for the first report from this
              agent.
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
                <Select.Value />
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
                      {value} days{value === 15 ? " (default)" : ""}
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
            <p className="text-xs text-muted">
              30-second samples for 24 hours, then one-minute summaries.
              Shortening retention permanently expires older history.
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
                  I acknowledge installing the agent with access to host and
                  Docker metrics.
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
                        title: "Update monitoring agent?",
                        description:
                          "Install the bundled agent version and rotate its upload credential. Reporting may pause briefly.",
                        actionLabel: "Update agent",
                      }
                    : undefined
                }
                onSuccess={() => {
                  setAcknowledged(false);
                  setRetention(null);
                }}
                success="Monitoring installation queued"
                pendingLabel="Queuing…"
                variant="primary"
              >
                {installed ? "Update agent" : "Enable monitoring"}
              </ActionButton>
              {installed || agent.status === "failed" ? (
                <ActionButton
                  action={() => api.post(`${endpoint}/actions/uninstall`)}
                  isDisabled={busy}
                  confirm={{
                    title: "Uninstall monitoring agent?",
                    description:
                      "Stop collection and remove the services and local buffer. Existing history stays available until its retention period expires.",
                    actionLabel: "Uninstall agent",
                  }}
                  success="Agent removal queued"
                  pendingLabel="Queuing…"
                >
                  Uninstall agent
                </ActionButton>
              ) : null}
            </div>
          ) : null}
          {!ready && !installed ? (
            <p className="text-sm text-muted">
              Prepare this server before enabling monitoring.
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
