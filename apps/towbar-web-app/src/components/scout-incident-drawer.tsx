"use client";
import { displayDateTime } from "@/lib/date-time-display";
import { ScoutIcon } from "./scout-icons";
import { RelativeTime } from "./last-synced-time";
import { ScoutIncidentNotifications } from "./scout-incident-notifications";
import { Tabs } from "@workspace/web-design-system/navigation/tabs";
import { useMemo, useState } from "react";
import { Button } from "@workspace/web-design-system/buttons/button";
import { Widget } from "@workspace/web-design-system/data-display/widget";
import { Drawer } from "@workspace/web-design-system/overlays/drawer";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { useApiQuery } from "@/hooks/use-api-query";
import {
  conditionDescription,
  metricDefinition,
  scoutValue,
  type ScoutIncident,
} from "./scout-controls";
import { ScoutIncidentChart } from "./scout-incident-chart";
import {
  ScoutIncidentSeverityChip,
  ScoutIncidentStateChip,
} from "./scout-incident-chips";

export type IncidentDetails = {
  incident: ScoutIncident & { environment: string | null };
  entity: { id: string; name: string; kind: string };
  history: {
    startAt: string;
    endAt: string;
    stepSeconds: number;
    points: Array<{ at: string; value: number | null }>;
    notes: string[];
    aggregation: "maximum" | "minimum";
  };
};
export const incidentTime = displayDateTime;

export function ScoutIncidentDrawer({
  serverId,
  incident,
  onClose,
}: {
  serverId: string;
  incident: ScoutIncident;
  onClose: () => void;
}) {
  return (
    <Drawer.Backdrop
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Drawer.Content placement="right">
        <Drawer.Dialog className="w-full max-w-3xl">
          <Drawer.CloseTrigger aria-label="Close incident" />
          <Drawer.Header>
            <p className="text-sm text-muted">Incident details</p>
            <Drawer.Heading>{incident.ruleName}</Drawer.Heading>
          </Drawer.Header>
          <Drawer.Body>
            <IncidentBody
              key={incident.id}
              serverId={serverId}
              initial={incident}
            />
          </Drawer.Body>
          <Drawer.Footer>
            <Button slot="close" variant="secondary">
              Close
            </Button>
          </Drawer.Footer>
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Backdrop>
  );
}
function IncidentBody({
  serverId,
  initial,
}: {
  serverId: string;
  initial: ScoutIncident;
}) {
  const [tab, setTab] = useState("overview");
  const query = useApiQuery<IncidentDetails>(
    `/v1/core/servers/${serverId}/scout-alerts/incidents/${initial.id}`,
    30_000,
  );
  const incident = query.data?.incident ?? initial;
  const details = useMemo(
    () => [
      ["Entity", query.data ? query.data.entity.name : "Loading…"],
      [
        "Started",
        <RelativeTime
          key="started"
          label="Started"
          value={incident.openedAt}
        />,
      ],
      [
        "Ended",
        incident.resolvedAt ? (
          <RelativeTime key="ended" label="Ended" value={incident.resolvedAt} />
        ) : (
          "Ongoing"
        ),
      ],
      [
        incident.resolvedAt ? "Final reading" : "Latest reading",
        scoutValue(incident.lastValue, incident.condition.metric),
      ],
      ["Resolution", incident.resolutionReason?.replaceAll("_", " ") ?? "—"],
      [
        "Last notification queued",
        incident.lastNotifiedAt ? (
          <RelativeTime
            key="notified"
            label="Last notification queued"
            value={incident.lastNotifiedAt}
          />
        ) : (
          "None"
        ),
      ],
    ],
    [incident, query.data],
  );
  return (
    <div className="grid min-w-0 gap-6 pb-2">
      <div className="flex items-center gap-2">
        <ScoutIncidentStateChip incident={incident} />
        <ScoutIncidentSeverityChip severity={incident.severity} />
      </div>
      {query.error ? (
        <div className="grid gap-2">
          <QueryError message={query.error} />
          <Button variant="secondary" onPress={query.refresh}>
            <ScoutIcon name="refresh" />
            Retry
          </Button>
        </div>
      ) : null}
      <Tabs
        selectedKey={tab}
        onSelectionChange={(key) => setTab(String(key))}
        className="grid min-w-0 gap-5"
      >
        <Tabs.ListContainer>
          <Tabs.List aria-label="Incident sections">
            <Tabs.Tab
              id="overview"
              className="gap-1 px-2 text-xs sm:gap-2 sm:text-sm"
            >
              <ScoutIcon name="view" />
              Overview
              <Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab
              id="monitoring"
              className="gap-1 px-2 text-xs sm:gap-2 sm:text-sm"
            >
              <ScoutIcon name="performance" />
              Monitoring
              <Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab
              id="notifications"
              className="gap-1 px-2 text-xs sm:gap-2 sm:text-sm"
            >
              <ScoutIcon name="notifications" />
              Notifications
              <Tabs.Indicator />
            </Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>
        <Tabs.Panel id="overview" className="m-0 grid gap-5 p-0 outline-none">
          <p className="text-sm text-muted">
            {conditionDescription(incident.condition)}
          </p>
          {incident.condition.http ? (
            <p className="break-all text-sm">{incident.condition.http.url}</p>
          ) : null}
          <Widget className="min-w-0">
            <Widget.Header>
              <Widget.Title icon={<ScoutIcon name="alerts" />}>
                Incident details
              </Widget.Title>
            </Widget.Header>
            <Widget.Content>
              <dl className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                {details.map(([label, value]) => (
                  <div key={String(label)} className="min-w-0 overflow-x-auto">
                    <dt className="mb-1 text-sm text-muted">{label}</dt>
                    <dd className="break-words text-sm text-foreground">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            </Widget.Content>
            <Widget.Footer>
              <p className="min-w-0 text-xs">
                <span className="text-muted">Incident ID </span>
                <span className="break-all font-mono text-foreground">
                  {incident.id}
                </span>
              </p>
            </Widget.Footer>
          </Widget>
        </Tabs.Panel>
        <Tabs.Panel id="monitoring" className="m-0 min-w-0 p-0 outline-none">
          <section
            aria-label="Incident metric history"
            className="min-w-0 pt-3"
          >
            <Widget className="min-w-0">
              <Widget.Header>
                <Widget.Title icon={<ScoutIcon name="performance" />}>
                  {metricDefinition(incident.condition.metric).label}
                </Widget.Title>
              </Widget.Header>
              <Widget.Content className="min-w-0 pb-0 pl-0">
                {query.data ? (
                  <ScoutIncidentChart
                    incident={query.data.incident}
                    history={query.data.history}
                  />
                ) : !query.error ? (
                  <div className="min-h-64">
                    <QueryLoading />
                  </div>
                ) : null}
              </Widget.Content>
              <Widget.Footer>
                <Widget.FooterDescription className="tabular-nums">
                  {incidentTime(incident.openedAt)} →{" "}
                  {query.data ? incidentTime(query.data.history.endAt) : "Now"}
                </Widget.FooterDescription>
              </Widget.Footer>
            </Widget>
          </section>
        </Tabs.Panel>
        <Tabs.Panel id="notifications" className="m-0 min-w-0 p-0 outline-none">
          <ScoutIncidentNotifications
            serverId={serverId}
            incidentId={incident.id}
          />
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}
