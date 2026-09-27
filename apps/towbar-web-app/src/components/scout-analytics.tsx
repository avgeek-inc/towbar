"use client";

import { useState } from "react";
import type { AnalyticsReport } from "@workspace/towbar-web-client";
import { CodePanel } from "@workspace/towbar-web-ui/code-panel";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { Widget } from "@workspace/web-design-system/data-display/widget";
import { LineChart } from "@workspace/web-design-system/charts/line-chart";
import { EmptyState } from "@workspace/web-design-system/data-display/empty-state";
import { Table } from "@workspace/web-design-system/data-display/table";
import { ScoutSelect } from "./scout-controls";
import { useApiQuery } from "@/hooks/use-api-query";

const countryNames = new Intl.DisplayNames(["en"], { type: "region" });
const labels: Record<string, string> = {
  path: "Paths",
  referrer: "Referring websites",
  status: "Response codes",
  method: "Methods",
  country: "Countries",
  browser: "Browsers",
  device: "Devices",
};
const latencyLabels = [
  "≤10 ms",
  "10–50 ms",
  "50–100 ms",
  "100–250 ms",
  "250–500 ms",
  "500 ms–1 s",
  "1–2.5 s",
  "2.5–5 s",
  "5–10 s",
  "10–60 s",
  ">60 s",
];
const format = (n: number) => n.toLocaleString();

export function ScoutAnalytics({
  appId,
  supported = true,
}: {
  appId: string;
  supported?: boolean;
}) {
  const [kind, setKind] = useState<"request" | "pageview">("request");
  const [days, setDays] = useState(7);
  const query = useApiQuery<AnalyticsReport>(
    supported
      ? `/v1/core/apps/${appId}/analytics?kind=${kind}&days=${days}`
      : null,
  );
  if (!supported)
    return (
      <EmptyState>
        <EmptyState.Header>
          <EmptyState.Title>
            Analytics is available for single-container services
          </EmptyState.Title>
          <EmptyState.Description>
            Compose workloads do not support Scout analytics yet.
          </EmptyState.Description>
        </EmptyState.Header>
      </EmptyState>
    );
  if (query.error) return <QueryError message={query.error} />;
  if (!query.data) return <QueryLoading />;
  return (
    <AnalyticsView
      report={query.data}
      days={days}
      setDays={setDays}
      setKind={setKind}
    />
  );
}

export function AnalyticsView({
  report,
  days,
  setDays,
  setKind,
}: {
  report: AnalyticsReport;
  days: number;
  setDays: (n: number) => void;
  setKind: (kind: "request" | "pageview") => void;
}) {
  if (!report.enabled)
    return (
      <EmptyState>
        <EmptyState.Header>
          <EmptyState.Title>
            Turn on analytics for this service
          </EmptyState.Title>
          <EmptyState.Description>
            Add analytics with enabled: true, deploy the service, and install or
            update Scout Agent on its server. Add pageviews: true and the
            optional script for website analytics. Data usually appears within a
            minute.
          </EmptyState.Description>
        </EmptyState.Header>
        <pre className="text-left text-sm">
          {
            "analytics:\n  enabled: true\n  pageviews: true\n  retentionDays: 30"
          }
        </pre>
        <a
          className="text-sm underline"
          href="https://www.towbar.dev/docs/analytics"
          target="_blank"
          rel="noreferrer"
        >
          Analytics setup guide
        </a>
      </EmptyState>
    );
  const pageviews = report.kind === "pageview";
  const metrics: [string, string][] = [
    [pageviews ? "Pageviews" : "Requests", format(report.total)],
  ];
  if (pageviews) {
    if (report.visitors !== null)
      metrics.push(
        ["Estimated visitors", format(report.visitors)],
        ["Estimated sessions", format(report.sessions ?? 0)],
      );
  } else
    metrics.push(
      ["HTTP errors (4xx + 5xx)", format(report.errors)],
      [
        "Average response time",
        report.meanMs === null ? "—" : `${report.meanMs.toFixed(1)} ms`,
      ],
    );
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <p className="max-w-prose text-sm text-muted">
          {pageviews
            ? "Browser-reported pageviews include navigation within a page. Blocked scripts and disabled JavaScript are not counted."
            : "Requests that reach this service, including API calls, images, scripts, and bots. Some requests may not be counted."}
        </p>
        <div className="grid w-full gap-3 sm:w-auto sm:grid-cols-2">
          <ScoutSelect
            label="Measure"
            value={report.kind}
            onChange={(value) => setKind(value as "request" | "pageview")}
            options={[
              { id: "request", label: "HTTP requests" },
              ...(report.config?.pageviews
                ? [{ id: "pageview", label: "Website pageviews" }]
                : []),
            ]}
          />
          <ScoutSelect
            label="Time range"
            value={String(days)}
            onChange={(value) => setDays(Number(value))}
            options={[1, 7, 30, 90]
              .filter((n) => n <= (report.config?.retentionDays ?? 30))
              .map((n) => ({
                id: String(n),
                label: `Last ${n === 1 ? "24 hours" : `${n} days`}`,
              }))}
          />
        </div>
      </div>
      {report.agentStatus !== "online" ? (
        <p role="status" className="text-sm text-warning">
          Scout Agent is {report.agentStatus}. Install or update Scout on the
          server to collect new analytics.
        </p>
      ) : null}
      {!report.collectionReady && report.agentStatus === "online" ? (
        <p role="status" className="text-sm text-warning">
          Scout cannot collect analytics yet. Update Scout on this service’s
          server and check the analytics setup guide.
        </p>
      ) : null}
      {report.droppedSamples > 0 ||
      report.collectionErrors > 0 ||
      report.droppedEvents > 0 ? (
        <p role="status" className="text-sm text-warning">
          Scout could not collect or send some activity. Counts may be
          incomplete.
        </p>
      ) : null}
      {report.total > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {metrics.map(([label, value]) => (
            <Widget key={label}>
              <Widget.Header>
                <Widget.Title>{label}</Widget.Title>
              </Widget.Header>
              <Widget.Content>
                <p className="text-2xl font-medium tabular-nums">{value}</p>
              </Widget.Content>
            </Widget>
          ))}
        </div>
      ) : null}
      {!report.total ? (
        <EmptyState>
          <EmptyState.Header>
            <EmptyState.Title>
              No {pageviews ? "pageviews" : "requests"} in this range
            </EmptyState.Title>
            <EmptyState.Description>
              {pageviews
                ? "Add the script shown below to your site and visit a page. Data usually appears within a minute."
                : "Visit this service. Data usually appears within a minute."}
            </EmptyState.Description>
          </EmptyState.Header>
        </EmptyState>
      ) : (
        <Widget>
          <Widget.Header>
            <Widget.Title>
              {pageviews ? "Pageview trend" : "Request trend"}
            </Widget.Title>
          </Widget.Header>
          <Widget.Content>
            <LineChart
              data={report.trend}
              height={240}
              aria-label={
                pageviews ? "Pageviews over time" : "Requests over time"
              }
            >
              <LineChart.Grid vertical={false} />
              <LineChart.XAxis
                dataKey="at"
                tickFormatter={(value) =>
                  new Date(String(value)).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    ...(days === 1 ? { hour: "numeric" } : {}),
                  })
                }
              />
              <LineChart.YAxis allowDecimals={false} />
              <LineChart.Tooltip
                labelFormatter={(label) =>
                  new Date(String(label)).toLocaleString(undefined, {
                    dateStyle: "medium",
                    ...(days === 1 ? { timeStyle: "short" } : {}),
                  })
                }
              />
              <LineChart.Line
                dataKey="count"
                name={pageviews ? "Pageviews" : "Requests"}
                stroke="var(--accent)"
                isAnimationActive={false}
                dot={false}
              />
              {!pageviews ? (
                <LineChart.Line
                  dataKey="errors"
                  name="HTTP errors"
                  stroke="var(--danger)"
                  isAnimationActive={false}
                  dot={false}
                />
              ) : null}
            </LineChart>
          </Widget.Content>
        </Widget>
      )}
      {report.total > 0 ? (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {Object.entries(report.dimensions).map(([key, rows]) => (
            <Widget
              key={key}
              className={
                ["path", "referrer"].includes(key) ? "lg:col-span-2" : undefined
              }
            >
              <Widget.Header>
                <Widget.Title>{labels[key] ?? key}</Widget.Title>
                <span className="text-xs text-muted">Top 20</span>
              </Widget.Header>
              <Widget.Content>
                <AnalyticsRows
                  rows={
                    key === "country"
                      ? rows.map((row) => ({
                          ...row,
                          value: /^[A-Z]{2}$/u.test(row.value)
                            ? (countryNames.of(row.value) ?? row.value)
                            : row.value,
                        }))
                      : rows
                  }
                  total={report.total}
                  showShare={key !== "country"}
                />
              </Widget.Content>
            </Widget>
          ))}
          {!pageviews ? (
            <Widget className="lg:col-span-2">
              <Widget.Header>
                <Widget.Title>Response times</Widget.Title>
              </Widget.Header>
              <Widget.Content>
                <p className="mb-3 text-sm text-muted">
                  {report.p95Ms === null
                    ? "Some responses took over 60 seconds."
                    : `95% of responses finished within ${format(report.p95Ms)} ms.`}{" "}
                  Total data sent: {(report.bytes / 1024 / 1024).toFixed(1)}{" "}
                  MiB.
                </p>
                <AnalyticsRows
                  name="Time range"
                  showShare={false}
                  rows={report.histogram
                    .map((count, i) => ({
                      value: latencyLabels[i]!,
                      count,
                    }))
                    .filter((row) => row.count > 0)}
                  total={report.total}
                />
                <p className="mt-3 text-xs text-muted">
                  Time spent handling and sending each response. The 95% summary
                  is an estimate based on these ranges.
                </p>
              </Widget.Content>
            </Widget>
          ) : null}
        </div>
      ) : null}
      {pageviews ? (
        <div className="space-y-2 text-sm text-muted">
          <p>Add once to your page template:</p>
          <CodePanel ariaLabel="Pageview script" language="html">
            {
              '<script defer src="/.well-known/towbar-analytics/script.js"></script>'
            }
          </CodePanel>
          <p>
            {report.config?.visitorIdentity
              ? "Visitor and session estimates are on."
              : "Visitor and session estimates are off."}
          </p>
          <p>
            Country estimates:{" "}
            <a
              className="underline"
              href="https://db-ip.com"
              target="_blank"
              rel="noreferrer"
            >
              IP Geolocation by DB-IP
            </a>
            .
          </p>
        </div>
      ) : null}
      <p className="text-xs text-muted">
        History is kept for {report.config?.retentionDays} days.{" "}
        <a
          className="underline"
          href="https://www.towbar.dev/docs/analytics"
          target="_blank"
          rel="noreferrer"
        >
          Setup and collection details
        </a>
      </p>
    </div>
  );
}
function AnalyticsRows({
  rows,
  total,
  name = "Name",
  showShare = true,
}: {
  name?: string;
  showShare?: boolean;
  rows: { value: string; count: number }[];
  total: number;
}) {
  if (!rows.length) return <p className="text-sm text-muted">No data yet.</p>;
  return (
    <Table>
      <Table.ScrollContainer>
        <Table.Content
          aria-label="Activity breakdown"
          className="w-full table-fixed"
        >
          <Table.Header>
            <Table.Column isRowHeader>{name}</Table.Column>
            <Table.Column className="w-20 text-right">Count</Table.Column>
            {showShare ? (
              <Table.Column className="hidden text-right sm:table-cell">
                Share
              </Table.Column>
            ) : null}
          </Table.Header>
          <Table.Body>
            {rows.map((row) => (
              <Table.Row id={row.value} key={row.value}>
                <Table.Cell>
                  <span className="block truncate" title={row.value}>
                    {row.value}
                  </span>
                </Table.Cell>
                <Table.Cell className="text-right tabular-nums">
                  {format(row.count)}
                </Table.Cell>
                {showShare ? (
                  <Table.Cell className="hidden text-right tabular-nums text-muted sm:table-cell">
                    {total ? ((row.count / total) * 100).toFixed(1) : "0"}%
                  </Table.Cell>
                ) : null}
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}
