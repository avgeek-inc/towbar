"use client";

import {
  MonitoringEventMarker,
  monitoringEventColor,
} from "./monitoring-events";
import { PageSelectionTitle } from "./page-selection-title";
import { Analytics01Icon, FilterIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useState } from "react";
import styles from "./scout-analytics.module.css";
import type {
  AnalyticsReport,
  AnalyticsFilter,
} from "@workspace/towbar-web-client";
import {
  FilterDialog,
  type FilterField,
} from "@workspace/towbar-web-ui/filter-dialog";
import { CodePanel } from "@workspace/towbar-web-ui/code-panel";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { Button } from "@workspace/web-design-system/buttons/button";
import { Widget } from "@workspace/web-design-system/data-display/widget";
import { LineChart } from "@workspace/web-design-system/charts/line-chart";
import { EmptyState } from "@workspace/web-design-system/data-display/empty-state";
import { Table } from "@workspace/web-design-system/data-display/table";
import { NewTabIndicator } from "@workspace/web-design-system/navigation/new-tab-indicator";
import { Tooltip } from "@workspace/web-design-system/overlays/tooltip";
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
}: {
  appId: string;
  domain?: string;
  supported?: boolean;
}) {
  const [kind, setKind] = useState<"request" | "pageview">("request");
  const [days, setDays] = useState(7);
  const [filters, setFilters] = useState<AnalyticsFilter[]>([]);
  const filterFields: FilterField<
    AnalyticsFilter["field"],
    AnalyticsFilter["operator"]
  >[] = [
    pathFilterField,
    {
      field: "referrer",
      label: "Referring website",
      operators: [{ value: "in", label: "is one of" }],
      searchable: true,
    },
    ...(kind === "pageview"
      ? [
          {
            field: "country" as const,
            label: "Country",
            operators: [{ value: "in" as const, label: "is one of" }],
            searchable: true,
          },
          {
            field: "city" as const,
            label: "City",
            operators: [{ value: "in" as const, label: "is one of" }],
            searchable: true,
          },
          {
            field: "browser" as const,
            label: "Browser",
            operators: [{ value: "in" as const, label: "is one of" }],
            searchable: true,
          },
        ]
      : []),
  ];
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
          icon={<HugeiconsIcon icon={Analytics01Icon} />}
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
        icon={<HugeiconsIcon icon={Analytics01Icon} />}
        keepEntityName
        actions={
          <FilterDialog
            fields={filterFields}
            value={filters}
            onChange={setFilters}
            getOptions={getFilterOptions}
            renderOption={(field, value) => (
              <span className="flex min-w-0 items-center gap-2">
                {field === "country" || field === "city" ? (
                  <span aria-hidden="true" className="w-5 shrink-0 text-center">
                    {/^[A-Z]{2}$/u.test(locationCountry(field, value))
                      ? String.fromCodePoint(
                          ...[...locationCountry(field, value)].map(
                            (letter) => 0x1f1e6 + letter.charCodeAt(0) - 65,
                          ),
                        )
                      : "🌐"}
                  </span>
                ) : (
                  <AnalyticsRowIcon dimension={field} value={value} />
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
            if (next === "request")
              setFilters((current) =>
                current.filter(
                  (filter) =>
                    !["country", "city", "browser"].includes(filter.field),
                ),
              );
            setKind(next);
          }}
          onFilterPath={(path) =>
            setFilters((current) => {
              if (
                current.length >= 8 ||
                current.some(
                  (filter) =>
                    filter.field === "path" &&
                    filter.operator === "equals" &&
                    filter.value === path,
                )
              )
                return current;
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
    at: Date.parse(point.at),
    previous: report.comparison?.trend[index]?.count ?? null,
  }));
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
                type="number"
                scale="time"
                domain={[Date.parse(report.start), Date.parse(report.end)]}
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
                        new Date(Number(value)).toLocaleString(undefined, {
                          dateStyle: "medium",
                          ...(days === 1 ? { timeStyle: "short" } : {}),
                        })
                      }
                      valueFormatter={(value) => format(Number(value))}
                    >
                      {point?.previous != null ? (
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
              <LineChart.Line
                dataKey="count"
                name={pageviews ? "Pageviews" : "Requests"}
                stroke="var(--accent)"
                strokeWidth={1.8}
                isAnimationActive={false}
                dot={false}
              />
              {report.comparison ? (
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
            {report.comparison ? (
              <Widget.Legend className="mt-2 flex-wrap">
                <Widget.LegendItem color="var(--accent)">
                  {pageviews ? "Pageviews" : "Requests"}
                </Widget.LegendItem>
                <Widget.LegendItem color="var(--warning)">
                  {comparisonLabel} (dashed)
                </Widget.LegendItem>
                {!pageviews ? (
                  <Widget.LegendItem color="var(--danger)">
                    HTTP errors
                  </Widget.LegendItem>
                ) : null}
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
                onFilterPath={key === "path" ? onFilterPath : undefined}
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
      {pageviews && report.total > 0 ? (
        <p className="text-xs text-muted">
          IP Geolocation by{" "}
          <a
            href="https://db-ip.com"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4"
          >
            DB-IP
          </a>
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
  onFilterPath,
}: {
  name: string;
  dimension?: string;
  domain?: string;
  onFilterPath?: (path: string) => void;
  rows: { value: string; count: number }[];
  total: number;
}) {
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
  const orderedRows = numbered
    ? [...rows].sort(
        (left, right) =>
          right.count - left.count || left.value.localeCompare(right.value),
      )
    : rows;
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
              <span className="flex h-4 items-center gap-1">
                {name}
                {location ? (
                  <HeadingHelp
                    title={name}
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
}: {
  value: string;
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
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          title={label}
          className="inline-flex min-w-0 items-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          <span className="truncate">{label}</span>
          <span className={`inline-flex shrink-0 ${styles.rowAction}`}>
            <NewTabIndicator />
          </span>
        </a>
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
            aria-label={`Filter by path ${value}`}
            className={`hidden size-5 min-w-0 shrink-0 rounded-sm bg-transparent! p-0 hover:bg-transparent! sm:inline-flex ${styles.rowAction}`}
            onPress={() => onFilterPath(value)}
          >
            <HugeiconsIcon icon={FilterIcon} className="size-3.5" />
          </Button>
          <Tooltip.Content>Filter by this path</Tooltip.Content>
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
      {change > 0 ? "+" : ""}
      {change.toFixed(1)}%{" "}
      <span className="text-muted">vs previous period</span>
    </p>
  );
}
