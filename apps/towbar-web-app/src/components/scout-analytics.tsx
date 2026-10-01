"use client";

import {
  MonitoringEventMarker,
  monitoringEventColor,
} from "./monitoring-events";
import { PageSelectionTitle } from "./page-selection-title";
import {
  ChartNoAxesColumnIcon,
  FilterIcon,
  FilterRemoveIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useId, useState } from "react";
import styles from "./scout-analytics.module.css";
import {
  analyticsHttpFilterFields,
  analyticsWebFilterFields,
  analyticsResponseTimeRanges,
  type AnalyticsReport,
  type AnalyticsFilter,
} from "@workspace/towbar-web-client";
import {
  FilterDialog,
  type FilterField,
} from "@workspace/towbar-web-ui/filter-dialog";
import { CodePanel } from "@workspace/towbar-web-ui/code-panel";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { Checkbox } from "@workspace/web-design-system/forms/checkbox";
import { Label } from "@workspace/web-design-system/forms/label";
import { Button } from "@workspace/web-design-system/buttons/button";
import { Widget } from "@workspace/web-design-system/data-display/widget";
import { LineChart } from "@workspace/web-design-system/charts/line-chart";
import { EmptyState } from "@workspace/web-design-system/data-display/empty-state";
import { Table } from "@workspace/web-design-system/data-display/table";
import { InlineExternalLink } from "@workspace/web-design-system/navigation/inline-external-link";
import {
  Tooltip,
  TooltipText,
} from "@workspace/web-design-system/overlays/tooltip";
import { HeadingHelp } from "@workspace/web-design-system/overlays/heading-help";
import { AnalyticsRowIcon } from "./analytics-row-icon";
import { ScoutIcon } from "./scout-icons";
import { ScoutSelect } from "./scout-controls";
import { useApiQuery } from "@/hooks/use-api-query";
import { api } from "@/lib/api";

const axisTick = { fill: "var(--muted)", fontSize: 10 };
const countryNames = new Intl.DisplayNames(["en"], { type: "region" });
const labels: Record<string, string> = {
  path: "Paths",
  referrer: "Referring websites",
  status: "Response codes",
  method: "Methods",
  country: "Countries",
  city: "Cities",
  browser: "Browsers",
  device: "Devices",
};
const latencyLabels = analyticsResponseTimeRanges;
const format = (n: number) => n.toLocaleString();
function pathFilterMatches(filter: AnalyticsFilter, path: string) {
  return (
    filter.field === "path" &&
    typeof filter.value === "string" &&
    (filter.operator === "equals"
      ? filter.value === path
      : filter.operator === "startsWith" && path.startsWith(filter.value))
  );
}
const pathFilterField: FilterField<
  AnalyticsFilter["field"],
  AnalyticsFilter["operator"]
> = {
  field: "path",
  label: "Path",
  operators: [
    { value: "equals", label: "is" },
    { value: "startsWith", label: "starts with" },
  ],
  placeholder: "/docs",
  pattern: "/[^?#\\r\\n]*",
  maxLength: 256,
};

export function ScoutAnalytics({
  appId,
  domain,
  supported = true,
  webAnalyticsEnabled = true,
}: {
  appId: string;
  domain?: string;
  supported?: boolean;
  webAnalyticsEnabled?: boolean;
}) {
  const [kind, setKind] = useState<"request" | "pageview">(
    webAnalyticsEnabled ? "pageview" : "request",
  );
  const [days, setDays] = useState(7);
  const [filters, setFilters] = useState<AnalyticsFilter[]>([]);
  const filterLabels: Record<AnalyticsFilter["field"], string> = {
    path: "Path",
    referrer: "Referring website",
    status: "Response code",
    method: "Method",
    responseTime: "Response time",
    country: "Country",
    city: "City",
    browser: "Browser",
    device: "Device",
    destination: "Outbound website",
  };
  const filterFields: FilterField<
    AnalyticsFilter["field"],
    AnalyticsFilter["operator"]
  >[] = (
    kind === "request" ? analyticsHttpFilterFields : analyticsWebFilterFields
  ).map((field) =>
    field === "path"
      ? pathFilterField
      : {
          field,
          label: filterLabels[field],
          operators: [{ value: "in", label: "is one of" }],
          searchable: true,
        },
  );
  const getFilterOptions = useCallback(
    async (field: AnalyticsFilter["field"], search: string) => {
      if (field === "path") return [];
      const params = new URLSearchParams({
        field,
        kind,
        days: String(days),
        search: field === "country" ? "" : search,
      });
      const { options } = await api.get<{ options: string[] }>(
        `/v1/core/apps/${appId}/analytics/filter-options?${params}`,
      );
      return field === "country"
        ? options.filter((code) =>
            `${code} ${/^[A-Z]{2}$/u.test(code) ? (countryNames.of(code) ?? "") : ""}`
              .toLowerCase()
              .includes(search.toLowerCase()),
          )
        : options;
    },
    [appId, days, kind],
  );
  const params = new URLSearchParams({ kind, days: String(days) });
  if (filters.length) params.set("filters", JSON.stringify(filters));
  const query = useApiQuery<AnalyticsReport>(
    supported ? `/v1/core/apps/${appId}/analytics?${params}` : null,
  );
  if (!supported)
    return (
      <>
        <PageSelectionTitle
          label="Analytics"
          icon={<HugeiconsIcon icon={ChartNoAxesColumnIcon} />}
          keepEntityName
        />
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
      </>
    );
  return (
    <>
      <PageSelectionTitle
        label="Analytics"
        icon={<HugeiconsIcon icon={ChartNoAxesColumnIcon} />}
        keepEntityName
        actions={
          <div className="hidden sm:block">
            <FilterDialog
              fields={filterFields}
              value={filters}
              onChange={setFilters}
              getOptions={getFilterOptions}
              renderOption={(field, value) => (
                <span className="flex min-w-0 items-center gap-2">
                  {field === "country" || field === "city" ? (
                    <span
                      aria-hidden="true"
                      className="w-5 shrink-0 text-center"
                    >
                      {/^[A-Z]{2}$/u.test(locationCountry(field, value))
                        ? String.fromCodePoint(
                            ...[...locationCountry(field, value)].map(
                              (letter) => 0x1f1e6 + letter.charCodeAt(0) - 65,
                            ),
                          )
                        : "🌐"}
                    </span>
                  ) : (
                    <AnalyticsRowIcon
                      dimension={field === "destination" ? "referrer" : field}
                      value={value}
                    />
                  )}
                  <span className="truncate">
                    {field === "country" && value !== "Unknown"
                      ? (countryNames.of(value) ?? value)
                      : field === "city"
                        ? cityLabel(value)
                        : value}
                  </span>
                </span>
              )}
            />
          </div>
        }
      />
      {query.error ? (
        <QueryError message={query.error} />
      ) : !query.data ? (
        <QueryLoading />
      ) : (
        <AnalyticsView
          report={query.data}
          domain={domain}
          days={days}
          setDays={setDays}
          setKind={(next) => {
            const available =
              next === "request"
                ? analyticsHttpFilterFields
                : analyticsWebFilterFields;
            setFilters((current) =>
              current.filter((filter) =>
                available.some((field) => field === filter.field),
              ),
            );
            setKind(next);
          }}
          onFilterPath={(path) =>
            setFilters((current) => {
              if (current.some((filter) => pathFilterMatches(filter, path)))
                return current.filter(
                  (filter) => !pathFilterMatches(filter, path),
                );
              if (current.length >= 8) return current;
              return [
                ...current,
                { field: "path", operator: "equals", value: path },
              ];
            })
          }
        />
      )}
    </>
  );
}

export function AnalyticsView({
  report,
  domain,
  days,
  setDays,
  setKind,
  onFilterPath,
}: {
  report: AnalyticsReport;
  domain?: string;
  days: number;
  setDays: (n: number) => void;
  setKind: (kind: "request" | "pageview") => void;
  onFilterPath: (path: string) => void;
}) {
  const [eventActive, setEventActive] = useState(false);
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [selectedMetric, setSelectedMetric] = useState<
    "count" | "errors" | "visitors" | "sessions" | null
  >(null);
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
        {
          label: "Estimated visitors",
          value: report.visitors,
          previous: report.comparison?.visitors,
          lowerIsBetter: false,
        },
        {
          label: "Time spent",
          value: report.averageTimeMs ?? null,
          previous: report.comparison?.averageTimeMs,
          lowerIsBetter: false,
          unit: "time",
          help: "Average time a page was visible in a browser tab. Hidden tabs do not add time.",
        },
        {
          label: "Bounce rate",
          value: report.bounceRate ?? null,
          previous: report.comparison?.bounceRate,
          lowerIsBetter: true,
          unit: "percent",
          help: "Share of finished visits with one pageview. A visit finishes after 30 minutes without activity.",
        },
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
    at: Date.parse(point.at),
    previous: report.comparison?.trend[index]?.count ?? null,
    previousErrors: report.comparison?.trend[index]?.errors ?? null,
    previousVisitors: report.comparison?.trend[index]?.visitors ?? null,
    previousSessions: report.comparison?.trend[index]?.sessions ?? null,
  }));
  const webSeries = [
    {
      key: "count",
      previousKey: "previous",
      label: "Page views",
      color: "var(--accent)",
    },
    {
      key: "visitors",
      previousKey: "previousVisitors",
      label: "Estimated visitors",
      color: "var(--warning)",
    },
    {
      key: "sessions",
      previousKey: "previousSessions",
      label: "Estimated sessions",
      color: "var(--danger)",
    },
  ] as const;
  const httpSeries = [
    {
      key: "count",
      previousKey: "previous",
      label: "Requests",
      color: "var(--accent)",
    },
    {
      key: "errors",
      previousKey: "previousErrors",
      label: "HTTP errors",
      color: "var(--danger)",
    },
  ] as const;
  const chartSeries = pageviews ? webSeries : httpSeries;
  const activeMetric = chartSeries.some(({ key }) => key === selectedMetric)
    ? selectedMetric
    : null;
  const visibleSeries = chartSeries.filter(
    ({ key }) => activeMetric === null || key === activeMetric,
  );
  const showComparison =
    Boolean(report.comparison) && (!pageviews || compareEnabled);
  const breakdowns: {
    name: string;
    dimension: string;
    rows: { value: string; count: number }[];
    total: number;
    help?: string;
  }[] = Object.entries(report.dimensions).map(([dimension, rows]) => ({
    name: labels[dimension] ?? dimension,
    dimension,
    rows,
    total: report.total,
  }));
  if (!pageviews) {
    breakdowns.push({
      name: "Response times",
      dimension: "responseTime",
      rows: report.histogram
        .map((count, i) => ({ value: latencyLabels[i]!, count }))
        .filter((row) => row.count > 0),
      total: report.total,
    });
  } else {
    if (report.config?.visitorIdentity)
      breakdowns.push({
        name: "Exit pages",
        dimension: "path",
        rows: report.exitPages ?? [],
        total: report.exits ?? 0,
        help: "The last page viewed in each finished visit. A visit finishes after 30 minutes without activity.",
      });
    breakdowns.push({
      name: "Outbound websites",
      dimension: "referrer",
      rows: report.outboundLinks ?? [],
      total: report.outboundClicks ?? 0,
      help: "Websites whose links visitors clicked, including links opened in a new tab. A click does not prove the visitor left your site.",
    });
  }
  const breakdownColumns: [typeof breakdowns, typeof breakdowns] = [[], []];
  const columnHeights: [number, number] = [0, 0];
  for (const breakdown of breakdowns) {
    const column = columnHeights[0] <= columnHeights[1] ? 0 : 1;
    breakdownColumns[column].push(breakdown);
    columnHeights[column] +=
      Math.max(1, Math.min(breakdown.rows.length, 10)) +
      1 +
      (breakdown.rows.length > 10 ? 1 : 0);
  }
  const hasTrend = report.total > 0 || (report.comparison?.total ?? 0) > 0;
  const comparisonLabel = `Previous ${days === 1 ? "24 hours" : `${days} days`}`;
  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:max-w-lg">
          <ScoutSelect
            label="Measure"
            value={report.kind}
            onChange={(value) => setKind(value as "request" | "pageview")}
            options={[
              ...(report.config?.pageviews
                ? [{ id: "pageview", label: "Web analytics" }]
                : []),
              { id: "request", label: "HTTP analytics" },
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
      {report.filters.some((filter) => filter.field === "responseTime") &&
      report.meanMs === null &&
      report.total > 0 ? (
        <p className="text-xs text-muted">
          Response time filters use recorded histogram ranges. An exact average
          is unavailable when a range selects part of an aggregate.
        </p>
      ) : null}
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
        <div
          className={`grid gap-4 ${pageviews ? "grid-cols-1 sm:grid-cols-2 xl:grid-cols-4" : "grid-cols-2 sm:grid-cols-3"}`}
        >
          {metrics.map(
            ({ label, value, previous, lowerIsBetter, ...metric }) => (
              <Widget key={label} className="min-w-0">
                <Widget.Header>
                  <Widget.Title>
                    {label}
                    {"help" in metric && metric.help ? (
                      <HeadingHelp
                        title={label}
                        help={{
                          description: metric.help,
                          href: "/docs/analytics",
                        }}
                      />
                    ) : null}
                  </Widget.Title>
                </Widget.Header>
                <Widget.Content>
                  <p className="text-2xl font-medium whitespace-nowrap tabular-nums">
                    {value === null
                      ? "—"
                      : "unit" in metric
                        ? metric.unit === "percent"
                          ? `${value.toFixed(1)}%`
                          : metric.unit === "time"
                            ? formatPageTime(value)
                            : `${value.toFixed(1)} ms`
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
              {report.filters.length
                ? "Try different filters or a wider time range."
                : pageviews
                  ? "Add the script shown below to your site and visit a page. Data usually appears within a minute."
                  : "Visit this service. Data usually appears within a minute."}
            </EmptyState.Description>
          </EmptyState.Header>
        </EmptyState>
      ) : (
        <Widget>
          <Widget.Header
            endContent={
              pageviews ? (
                <Checkbox
                  className="shrink-0"
                  variant="secondary"
                  isSelected={compareEnabled}
                  onChange={setCompareEnabled}
                  isDisabled={!report.comparison}
                >
                  <Checkbox.Content>
                    <Checkbox.Control>
                      <Checkbox.Indicator />
                    </Checkbox.Control>
                    <Label className="text-xs">Enable Compare</Label>
                  </Checkbox.Content>
                </Checkbox>
              ) : undefined
            }
          >
            <Widget.Title
              icon={<ScoutIcon name={pageviews ? "pageview" : "request"} />}
            >
              {pageviews ? "Trends" : "Request trend"}
            </Widget.Title>
          </Widget.Header>
          <Widget.Content>
            <LineChart
              data={trend}
              height={240}
              chartMargin={
                pageviews ? { top: 5, right: 0, bottom: 5, left: 5 } : undefined
              }
              aria-label={
                pageviews
                  ? "Page views, estimated visitors, and estimated sessions over time"
                  : "Requests over time"
              }
            >
              <LineChart.Grid vertical={false} />
              <LineChart.XAxis
                tick={axisTick}
                tickMargin={8}
                minTickGap={45}
                dataKey="at"
                type="number"
                scale="time"
                domain={
                  pageviews
                    ? ["dataMin", "dataMax"]
                    : [Date.parse(report.start), Date.parse(report.end)]
                }
                allowDataOverflow
                ticks={trend
                  .map((point) => point.at)
                  .filter(
                    (at) =>
                      at >= Date.parse(report.start) &&
                      at <= Date.parse(report.end),
                  )}
                tickFormatter={(value) =>
                  new Date(Number(value)).toLocaleDateString(undefined, {
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
                active={eventActive ? false : undefined}
                content={({ active, label, payload }) => {
                  const point = trend.find(
                    (point) => point.at === Number(label),
                  );
                  const orderedPayload = visibleSeries.flatMap(
                    ({ key, previousKey }) =>
                      [
                        payload.find((item) => item.dataKey === key),
                        payload.find((item) => item.dataKey === previousKey),
                      ].filter((item) => item !== undefined),
                  );
                  return (
                    <LineChart.TooltipContent
                      active={active}
                      payload={orderedPayload.map(
                        ({ color, dataKey, name, value }) => ({
                          color,
                          dataKey: String(dataKey),
                          name: String(name),
                          value: Number(value),
                        }),
                      )}
                      label={label}
                      labelFormatter={(value) =>
                        new Date(Number(value)).toLocaleString(undefined, {
                          dateStyle: "medium",
                          ...(days === 1 ? { timeStyle: "short" } : {}),
                        })
                      }
                      valueFormatter={(value, key) => (
                        <span
                          className={
                            String(key).startsWith("previous")
                              ? "text-muted"
                              : undefined
                          }
                        >
                          {format(Number(value))}
                        </span>
                      )}
                    >
                      {!pageviews && point?.previous != null ? (
                        <div className="mt-1 border-t border-separator pt-1">
                          <MetricChange
                            current={
                              activeMetric === "errors"
                                ? point.errors
                                : point.count
                            }
                            previous={
                              activeMetric === "errors"
                                ? point.previousErrors
                                : point.previous
                            }
                            lowerIsBetter={activeMetric === "errors"}
                            label={comparisonLabel}
                          />
                        </div>
                      ) : null}
                    </LineChart.TooltipContent>
                  );
                }}
              />
              {!pageviews &&
                report.deployments.map((event) => (
                  <LineChart.ReferenceLine
                    key={event.id}
                    x={Date.parse(event.at)}
                    zIndex={600}
                    stroke={monitoringEventColor(event.type)}
                    strokeDasharray="4 4"
                    strokeOpacity={0.6}
                    label={
                      <MonitoringEventMarker
                        event={event}
                        onActiveChange={setEventActive}
                      />
                    }
                  />
                ))}
              {visibleSeries.map(({ key, label, color }) => (
                <LineChart.Line
                  key={key}
                  dataKey={key}
                  name={label}
                  stroke={color}
                  strokeWidth={1.8}
                  isAnimationActive={false}
                  dot={false}
                />
              ))}
              {showComparison
                ? visibleSeries.map(({ previousKey, label, color }) => (
                    <LineChart.Line
                      key={previousKey}
                      dataKey={previousKey}
                      name={`${label} (${comparisonLabel})`}
                      stroke={color}
                      strokeOpacity={0.25}
                      strokeDasharray="5 4"
                      strokeWidth={1.8}
                      isAnimationActive={false}
                      dot={false}
                    />
                  ))
                : null}
            </LineChart>
            <Widget.Legend className="mt-2 flex-wrap">
              {chartSeries.map(({ key, label, color }) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={activeMetric === key}
                  className={`widget__legend-item rounded-sm py-1 outline-none focus-visible:ring-2 focus-visible:ring-focus ${activeMetric !== null && activeMetric !== key ? "opacity-40" : ""}`}
                  onClick={() =>
                    setSelectedMetric((current) =>
                      current === key ? null : key,
                    )
                  }
                >
                  <span
                    className="widget__legend-item-dot"
                    style={{ backgroundColor: color }}
                    aria-hidden="true"
                  />
                  <span className="widget__legend-item-label">{label}</span>
                </button>
              ))}
            </Widget.Legend>
            {showComparison ? (
              <p className="mt-2 text-xs text-muted">{comparisonLabel}</p>
            ) : null}
            {pageviews && !report.comparison ? (
              <p className="mt-2 text-xs text-muted">
                No prior period data to compare.
              </p>
            ) : null}
          </Widget.Content>
        </Widget>
      )}
      {report.total > 0 ? (
        <div
          key={`${report.kind}:${days}:${JSON.stringify(report.filters)}`}
          className="grid grid-cols-1 items-start gap-4 md:grid-cols-2"
        >
          {breakdownColumns.map((column, index) => (
            <div key={index} className="grid min-w-0 content-start gap-4">
              {column.map((breakdown) => (
                <AnalyticsRows
                  key={breakdown.name}
                  {...breakdown}
                  domain={domain}
                  onFilterPath={
                    breakdown.dimension === "path" ? onFilterPath : undefined
                  }
                  filters={report.filters}
                />
              ))}
            </div>
          ))}
        </div>
      ) : null}
      {pageviews && report.total > 0 ? (
        <p className="text-xs text-muted">
          IP Geolocation by{" "}
          <InlineExternalLink href="https://db-ip.com" tone="secondary">
            DB-IP
          </InlineExternalLink>
        </p>
      ) : null}
      {pageviews ? (
        <section
          className="space-y-5 pt-4"
          aria-labelledby="pageview-setup-title"
        >
          <div className="space-y-1">
            <h4 id="pageview-setup-title" className="text-sm font-medium">
              Track pageviews
            </h4>
            <p className="text-sm text-muted">
              Add this script to your site’s shared HTML template to count
              pageviews, time spent on each page, and clicks to other websites.
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
  help,
  domain,
  onFilterPath,
  filters = [],
}: {
  name: string;
  filters?: AnalyticsFilter[];
  dimension?: string;
  help?: string;
  domain?: string;
  onFilterPath?: (path: string) => void;
  rows: { value: string; count: number }[];
  total: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const tableId = useId();
  const country = dimension === "country";
  const location = country || dimension === "city";
  const numbered = [
    "path",
    "referrer",
    "country",
    "city",
    "browser",
    "device",
  ].includes(dimension);
  const sortedRows = numbered
    ? [...rows].sort(
        (left, right) =>
          right.count - left.count || left.value.localeCompare(right.value),
      )
    : rows;
  const orderedRows = sortedRows.slice(0, expanded ? 25 : 10);
  const maxCount = Math.max(0, ...rows.map((row) => row.count));
  return (
    <Table>
      <Table.ScrollContainer id={tableId}>
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
              <span className="flex h-4 items-center gap-1">
                {name}
                {location || help ? (
                  <HeadingHelp
                    title={name}
                    help={{
                      description:
                        help ?? "IP Geolocation provided by DB-IP database.",
                      href: "/docs/analytics",
                    }}
                  />
                ) : null}
              </span>
            </Table.Column>
            <Table.Column className="text-right">Count</Table.Column>
            <Table.Column className="text-right">%</Table.Column>
          </Table.Header>
          <Table.Body
            renderEmptyState={() => (
              <div className="p-4 text-xs text-muted">No data yet.</div>
            )}
          >
            {orderedRows.map((row, index) => (
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
                    {location &&
                    /^[A-Z]{2}$/u.test(
                      locationCountry(dimension, row.value),
                    ) ? (
                      <span aria-hidden="true">
                        {String.fromCodePoint(
                          ...[...locationCountry(dimension, row.value)].map(
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
                          : dimension === "city"
                            ? cityLabel(row.value)
                            : row.value
                      }
                      dimension={dimension}
                      domain={domain}
                      onFilterPath={onFilterPath}
                      filtered={filters.some((filter) =>
                        pathFilterMatches(filter, row.value),
                      )}
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
      {sortedRows.length > 10 ? (
        <Table.Footer className="flex items-center px-4 py-0!">
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={tableId}
            aria-label={`${expanded ? "Show fewer" : "Show more"} ${name.toLowerCase()}`}
            className="rounded-sm py-0 text-xs text-muted underline decoration-muted/30 decoration-dashed underline-offset-2 outline-none hover:decoration-muted focus-visible:ring-2 focus-visible:ring-focus"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "Show Less" : "Show More"}
          </button>
        </Table.Footer>
      ) : null}
    </Table>
  );
}

function locationCountry(dimension: string, value: string) {
  return dimension === "country"
    ? value
    : (/, ([A-Z]{2})$/u.exec(value)?.[1] ?? "");
}

function cityLabel(value: string) {
  const country = locationCountry("city", value);
  return country
    ? `${value.slice(0, -2)}${countryNames.of(country) ?? country}`
    : value;
}

function AnalyticsRowLabel({
  value,
  label,
  dimension,
  domain,
  onFilterPath,
  filtered,
}: {
  value: string;
  filtered: boolean;
  label: string;
  dimension: string;
  domain?: string;
  onFilterPath?: (path: string) => void;
}) {
  const href =
    dimension === "path" && domain && value.startsWith("/")
      ? `https://${domain}${value}`
      : dimension === "referrer" &&
          /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/u.test(value)
        ? `https://${value}`
        : undefined;
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      {href ? (
        <InlineExternalLink
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          title={label}
        >
          {label}
        </InlineExternalLink>
      ) : dimension === "city" ? (
        <TooltipText className="block truncate" tooltip={label} openOnPress>
          {label}
        </TooltipText>
      ) : (
        <span className="block truncate" title={label}>
          {label}
        </span>
      )}
      {onFilterPath && value.startsWith("/") ? (
        <Tooltip>
          <Button
            isIconOnly
            variant="ghost"
            aria-label={`${filtered ? "Remove filter for" : "Filter by"} path ${value}`}
            className={`hidden size-5 min-w-0 shrink-0 rounded-sm bg-transparent! p-0 hover:bg-transparent! sm:inline-flex ${styles.rowAction}`}
            onPress={() => onFilterPath(value)}
          >
            <HugeiconsIcon
              icon={filtered ? FilterRemoveIcon : FilterIcon}
              className={`size-3.5 ${filtered ? "text-danger" : ""}`}
            />
          </Button>
          <Tooltip.Content>
            {filtered ? "Remove path filter" : "Filter by this path"}
          </Tooltip.Content>
        </Tooltip>
      ) : null}
    </span>
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
      {change !== 0 ? (
        <>
          <span aria-hidden="true">{change > 0 ? "↑" : "↓"} </span>
          <span className="sr-only">
            {change > 0 ? "Increase of " : "Decrease of "}
          </span>
        </>
      ) : null}
      {Math.abs(change).toFixed(1)}%
      <span className="sr-only"> compared with the previous period</span>
    </p>
  );
}

function formatPageTime(ms: number) {
  if (ms < 1000) return "<1s";
  const seconds = Math.round(ms / 1000);
  return seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
