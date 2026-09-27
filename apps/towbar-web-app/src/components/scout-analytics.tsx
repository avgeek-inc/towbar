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
import { NewTabIndicator } from "@workspace/web-design-system/navigation/new-tab-indicator";
import { HeadingHelp } from "@workspace/web-design-system/overlays/heading-help";
import { AnalyticsRowIcon } from "./analytics-row-icon";
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
  "<10 ms",
  "10 to 50 ms",
  "50 to 100 ms",
  "100 to 200 ms",
  "200 to 500 ms",
  "500 ms to 1 s",
  "1 to 2.5 s",
  ">2.5 s",
];
const format = (n: number) => n.toLocaleString();

export function ScoutAnalytics({
  appId,
  domain,
  supported = true,
}: {
  appId: string;
  domain?: string;
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
      domain={domain}
      days={days}
      setDays={setDays}
      setKind={setKind}
    />
  );
}

export function AnalyticsView({
  report,
  domain,
  days,
  setDays,
  setKind,
}: {
  report: AnalyticsReport;
  domain?: string;
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
  const metrics = pageviews
    ? [
        {
          label: "Pageviews",
          value: report.total,
          previous: report.comparison?.total,
          lowerIsBetter: false,
        },
        ...(report.visitors === null
          ? []
          : [
              {
                label: "Estimated visitors",
                value: report.visitors,
                previous: report.comparison?.visitors,
                lowerIsBetter: false,
              },
              {
                label: "Estimated sessions",
                value: report.sessions,
                previous: report.comparison?.sessions,
                lowerIsBetter: false,
              },
            ]),
      ]
    : [
        {
          label: "Requests",
          value: report.total,
          previous: report.comparison?.total,
          lowerIsBetter: false,
        },
        {
          label: "HTTP errors (4xx + 5xx)",
          value: report.errors,
          previous: report.comparison?.errors,
          lowerIsBetter: true,
        },
        {
          label: "Average response time",
          value: report.meanMs,
          previous: report.comparison?.meanMs,
          lowerIsBetter: true,
          unit: "ms",
        },
      ];
  const trend = report.trend.map((point, index) => ({
    ...point,
    previous: report.comparison?.trend[index]?.count ?? null,
  }));
  const hasTrend = report.total > 0 || (report.comparison?.total ?? 0) > 0;
  const comparisonLabel = `Previous ${days === 1 ? "24 hours" : `${days} days`}`;
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
            options={[1, 7, 14, 30, 90]
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
      {hasTrend ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {metrics.map(
            ({ label, value, previous, lowerIsBetter, ...metric }) => (
              <Widget key={label} className="min-w-0">
                <Widget.Header>
                  <Widget.Title>{label}</Widget.Title>
                </Widget.Header>
                <Widget.Content>
                  <p className="text-2xl font-medium tabular-nums">
                    {value === null
                      ? "—"
                      : "unit" in metric
                        ? `${value.toFixed(1)} ms`
                        : format(value)}
                  </p>
                  <MetricChange
                    current={value}
                    previous={previous}
                    lowerIsBetter={lowerIsBetter}
                    label={comparisonLabel}
                  />
                </Widget.Content>
              </Widget>
            ),
          )}
        </div>
      ) : null}
      {!hasTrend ? (
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
              data={trend}
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
                content={({ active, label, payload }) => {
                  const point = trend.find((point) => point.at === label);
                  return (
                    <LineChart.TooltipContent
                      active={active}
                      payload={payload.map(
                        ({ color, dataKey, name, value }) => ({
                          color,
                          dataKey: String(dataKey),
                          name: String(name),
                          value: Number(value),
                        }),
                      )}
                      label={label}
                      labelFormatter={(value) =>
                        new Date(String(value)).toLocaleString(undefined, {
                          dateStyle: "medium",
                          ...(days === 1 ? { timeStyle: "short" } : {}),
                        })
                      }
                      valueFormatter={(value) => format(Number(value))}
                    >
                      {pageviews && point?.previous != null ? (
                        <div className="mt-1 border-t border-separator pt-1">
                          <MetricChange
                            current={point.count}
                            previous={point.previous}
                            lowerIsBetter={false}
                            label={comparisonLabel}
                          />
                        </div>
                      ) : null}
                    </LineChart.TooltipContent>
                  );
                }}
              />
              <LineChart.Line
                dataKey="count"
                name={pageviews ? "Pageviews" : "Requests"}
                stroke="var(--accent)"
                strokeWidth={1.8}
                isAnimationActive={false}
                dot={false}
              />
              {pageviews && report.comparison ? (
                <LineChart.Line
                  dataKey="previous"
                  name={comparisonLabel}
                  stroke="var(--warning)"
                  strokeDasharray="5 4"
                  strokeWidth={1.8}
                  dot={false}
                  isAnimationActive={false}
                />
              ) : null}
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
            {pageviews && report.comparison ? (
              <Widget.Legend className="mt-2 flex-wrap">
                <Widget.LegendItem color="var(--accent)">
                  Pageviews
                </Widget.LegendItem>
                <Widget.LegendItem color="var(--warning)">
                  {comparisonLabel} (dashed)
                </Widget.LegendItem>
              </Widget.Legend>
            ) : null}
          </Widget.Content>
        </Widget>
      )}
      {report.total > 0 ? (
        <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
          {Object.entries(report.dimensions).map(([key, rows]) => (
            <div key={key} className="min-w-0">
              <AnalyticsRows
                name={labels[key] ?? key}
                rows={rows}
                total={report.total}
                dimension={key}
                domain={domain}
              />
            </div>
          ))}
          {!pageviews ? (
            <div className="min-w-0">
              <AnalyticsRows
                name="Response times"
                rows={report.histogram
                  .map((count, i) => ({
                    value: latencyLabels[i]!,
                    count,
                  }))
                  .filter((row) => row.count > 0)}
                total={report.total}
              />
            </div>
          ) : null}
        </div>
      ) : null}
      {pageviews ? (
        <section className="space-y-3" aria-labelledby="pageview-setup-title">
          <div className="space-y-1">
            <h4 id="pageview-setup-title" className="text-sm font-medium">
              Track pageviews
            </h4>
            <p className="text-sm text-muted">
              Add this script to your site’s shared HTML template to count
              pageviews and navigation without a full reload.
            </p>
          </div>
          <CodePanel ariaLabel="Pageview script" language="html">
            {
              '<script defer src="/.well-known/towbar-analytics/script.js"></script>'
            }
          </CodePanel>
        </section>
      ) : null}
    </div>
  );
}
function AnalyticsRows({
  rows,
  total,
  name,
  dimension = "",
  domain,
}: {
  name: string;
  dimension?: string;
  domain?: string;
  rows: { value: string; count: number }[];
  total: number;
}) {
  const country = dimension === "country";
  const numbered = [
    "path",
    "referrer",
    "country",
    "browser",
    "device",
  ].includes(dimension);
  const maxCount = Math.max(0, ...rows.map((row) => row.count));
  return (
    <Table>
      <Table.ScrollContainer>
        <Table.Content
          aria-label={name}
          className={`w-full table-fixed ${styles.breakdown} ${numbered ? styles.numbered : ""}`}
        >
          <Table.Header>
            {numbered ? (
              <Table.Column
                className={styles.rankColumn}
                textValue="Row number"
              >
                <span className="sr-only">Row number</span>
              </Table.Column>
            ) : null}
            <Table.Column isRowHeader textValue={name}>
              <span className="inline-flex items-center gap-1">
                {name}
                {country ? (
                  <HeadingHelp
                    title="Countries"
                    help={{
                      description: "IP Geolocation provided by DB-IP database.",
                      href: "/docs/analytics",
                      linkLabel: "Learn more in documentation.",
                    }}
                  />
                ) : null}
              </span>
            </Table.Column>
            <Table.Column className="text-right">Count</Table.Column>
            <Table.Column className="text-right">%</Table.Column>
          </Table.Header>
          <Table.Body renderEmptyState={() => "No data yet."}>
            {rows.map((row, index) => (
              <Table.Row id={row.value} key={row.value}>
                {numbered ? (
                  <Table.Cell className={styles.rankCell}>
                    {index + 1}
                  </Table.Cell>
                ) : null}
                <Table.Cell className="relative overflow-hidden">
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none absolute inset-y-1 left-1 bg-accent ${styles.countBar}`}
                    style={{
                      width: `calc((100% - 0.5rem) * ${maxCount ? row.count / maxCount : 0})`,
                      opacity: maxCount
                        ? 0.04 + 0.16 * (row.count / maxCount)
                        : 0,
                    }}
                  />
                  <span className="relative flex min-w-0 items-center gap-2">
                    <AnalyticsRowIcon
                      key={`${dimension}:${row.value}`}
                      dimension={dimension}
                      value={row.value}
                    />
                    {country && /^[A-Z]{2}$/u.test(row.value) ? (
                      <span aria-hidden="true">
                        {String.fromCodePoint(
                          ...[...row.value].map(
                            (letter) => 127397 + letter.charCodeAt(0),
                          ),
                        )}
                      </span>
                    ) : null}
                    <AnalyticsRowLabel
                      value={row.value}
                      label={
                        country && /^[A-Z]{2}$/u.test(row.value)
                          ? (countryNames.of(row.value) ?? row.value)
                          : row.value
                      }
                      dimension={dimension}
                      domain={domain}
                    />
                  </span>
                </Table.Cell>
                <Table.Cell className="text-right tabular-nums">
                  {format(row.count)}
                </Table.Cell>
                <Table.Cell className="text-right tabular-nums text-muted">
                  {total ? ((row.count / total) * 100).toFixed(1) : "0"}%
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}

function AnalyticsRowLabel({
  value,
  label,
  dimension,
  domain,
}: {
  value: string;
  label: string;
  dimension: string;
  domain?: string;
}) {
  const href =
    dimension === "path" && domain && value.startsWith("/")
      ? `https://${domain}${value}`
      : dimension === "referrer" &&
          /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/u.test(value)
        ? `https://${value}`
        : undefined;
  if (!href)
    return (
      <span className="block truncate" title={label}>
        {label}
      </span>
    );
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={label}
      className="group inline-flex min-w-0 items-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-focus"
    >
      <span className="truncate">{label}</span>
      <span className="inline-flex shrink-0 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100">
        <NewTabIndicator />
      </span>
    </a>
  );
}

function MetricChange({
  current,
  previous,
  lowerIsBetter,
  label,
}: {
  current: number | null;
  previous: number | null | undefined;
  lowerIsBetter: boolean;
  label: string;
}) {
  if (current === null || previous === null || previous === undefined)
    return <p className="mt-1 text-xs text-muted">No prior period data</p>;
  if (previous === 0 && current !== 0)
    return (
      <p
        className={`mt-1 text-xs ${lowerIsBetter ? "text-danger-soft-foreground" : "text-success-soft-foreground"}`}
        title={`${label}: 0`}
      >
        New
      </p>
    );
  const change = previous === 0 ? 0 : ((current - previous) / previous) * 100;
  const improved = lowerIsBetter ? change < 0 : change > 0;
  return (
    <p
      className={`mt-1 text-xs tabular-nums ${change === 0 ? "text-muted" : improved ? "text-success-soft-foreground" : "text-danger-soft-foreground"}`}
      title={`${label}: ${format(previous)}`}
    >
      {change > 0 ? "+" : ""}
      {change.toFixed(1)}%{" "}
      <span className="text-muted">vs previous period</span>
    </p>
  );
}
