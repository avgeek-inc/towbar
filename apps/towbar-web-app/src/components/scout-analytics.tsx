"use client";

import { useState } from "react";
import styles from "./scout-analytics.module.css";
import type { AnalyticsReport } from "@workspace/towbar-web-client";
import { CodePanel } from "@workspace/towbar-web-ui/code-panel";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { Widget } from "@workspace/web-design-system/data-display/widget";
import { LineChart } from "@workspace/web-design-system/charts/line-chart";
import { EmptyState } from "@workspace/web-design-system/data-display/empty-state";
import { Table } from "@workspace/web-design-system/data-display/table";
import { ScoutIcon } from "./scout-icons";
import { ScoutSelect } from "./scout-controls";
import { useApiQuery } from "@/hooks/use-api-query";

const axisTick = { fill: "var(--muted)", fontSize: 10 };
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
          <EmptyState.Title>Analytics is disabled</EmptyState.Title>
          <EmptyState.Description>
            Enable analytics in the service manifest to see traffic for this
            service.
          </EmptyState.Description>
        </EmptyState.Header>
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
      <div className="space-y-4">
        <p className="max-w-prose text-sm text-muted">
          {pageviews
            ? "Counts pages opened in the browser, including navigation without a full reload. Blocked scripts and disabled JavaScript are not counted."
            : "Requests that reach this service, including API calls, images, scripts, and bots. Some requests may not be counted."}
        </p>
        <div className="grid grid-cols-2 gap-3 sm:max-w-lg">
          <ScoutSelect
            label="Measure"
            value={report.kind}
            onChange={(value) => setKind(value as "request" | "pageview")}
            options={[
              { id: "request", label: "HTTP requests" },
              ...(report.config?.pageviews
                ? [{ id: "pageview", label: "Pageviews" }]
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
            <Widget.Title
              icon={<ScoutIcon name={pageviews ? "pageview" : "request"} />}
            >
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
                tick={axisTick}
                tickMargin={8}
                minTickGap={45}
                dataKey="at"
                tickFormatter={(value) =>
                  new Date(String(value)).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    ...(days === 1 ? { hour: "numeric" } : {}),
                  })
                }
              />
              <LineChart.YAxis
                width="auto"
                tick={axisTick}
                tickMargin={4}
                allowDecimals={false}
              />
              <LineChart.Tooltip
                content={
                  <LineChart.TooltipContent
                    labelFormatter={(label) =>
                      new Date(String(label)).toLocaleString(undefined, {
                        dateStyle: "medium",
                        ...(days === 1 ? { timeStyle: "short" } : {}),
                      })
                    }
                    valueFormatter={(value) => format(Number(value))}
                  />
                }
              />
              <LineChart.Line
                dataKey="count"
                name={pageviews ? "Pageviews" : "Requests"}
                stroke="var(--accent)"
                strokeWidth={1.8}
                isAnimationActive={false}
                dot={false}
              />
              {!pageviews ? (
                <LineChart.Line
                  dataKey="errors"
                  name="HTTP errors"
                  stroke="var(--danger)"
                  strokeWidth={1.8}
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
            <div
              key={key}
              className={
                ["path", "referrer"].includes(key)
                  ? "min-w-0 lg:col-span-2"
                  : "min-w-0"
              }
            >
              <AnalyticsRows
                name={labels[key] ?? key}
                rows={rows}
                total={report.total}
                country={key === "country"}
                showShare={key === "status"}
              />
            </div>
          ))}
          {!pageviews ? (
            <div className="min-w-0 space-y-3 lg:col-span-2">
              <p className="mb-3 text-sm text-muted">
                {report.p95Ms === null
                  ? "Some responses took over 60 seconds."
                  : `95% of responses finished within ${format(report.p95Ms)} ms.`}{" "}
                Total data sent: {(report.bytes / 1024 / 1024).toFixed(1)} MiB.
              </p>
              <AnalyticsRows
                name="Response times"
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
            </div>
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
        </div>
      ) : null}
      {pageviews ? (
        <p className="text-xs text-muted">
          Note:{" "}
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
      ) : null}
    </div>
  );
}
function AnalyticsRows({
  rows,
  total,
  name,
  showShare = false,
  country = false,
}: {
  name: string;
  country?: boolean;
  showShare?: boolean;
  rows: { value: string; count: number }[];
  total: number;
}) {
  const maxCount = Math.max(0, ...rows.map((row) => row.count));
  return (
    <Table>
      <Table.ScrollContainer>
        <Table.Content
          aria-label={name}
          className={`w-full table-fixed ${styles.breakdown}`}
        >
          <Table.Header>
            <Table.Column isRowHeader>{name}</Table.Column>
            <Table.Column className="text-right">Count</Table.Column>
            {showShare ? (
              <Table.Column className="text-right">Percent</Table.Column>
            ) : null}
          </Table.Header>
          <Table.Body renderEmptyState={() => "No data yet."}>
            {rows.map((row) => (
              <Table.Row id={row.value} key={row.value}>
                <Table.Cell className="relative">
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-y-1 left-0 rounded-r bg-accent/10"
                    style={{
                      width: `${maxCount ? (row.count / maxCount) * 100 : 0}%`,
                    }}
                  />
                  <span className="relative flex min-w-0 items-center gap-2">
                    {country && /^[A-Z]{2}$/u.test(row.value) ? (
                      <span aria-hidden="true">
                        {String.fromCodePoint(
                          ...[...row.value].map(
                            (letter) => 127397 + letter.charCodeAt(0),
                          ),
                        )}
                      </span>
                    ) : null}
                    <span
                      className="block truncate"
                      title={
                        country && /^[A-Z]{2}$/u.test(row.value)
                          ? (countryNames.of(row.value) ?? row.value)
                          : row.value
                      }
                    >
                      {country && /^[A-Z]{2}$/u.test(row.value)
                        ? (countryNames.of(row.value) ?? row.value)
                        : row.value}
                    </span>
                  </span>
                </Table.Cell>
                <Table.Cell className="text-right tabular-nums">
                  {format(row.count)}
                </Table.Cell>
                {showShare ? (
                  <Table.Cell className="text-right tabular-nums text-muted">
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
