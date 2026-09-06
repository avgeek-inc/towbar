"use client";

import {
  memo,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FormEvent } from "react";
import type {
  ComparisonPoint,
  ComparisonMetricSummary,
  MonitoringAggregates,
} from "@workspace/towbar-web-client";
import { Button } from "@workspace/web-design-system/buttons/button";
import { Chip } from "@workspace/web-design-system/data-display/chip";
import { Widget } from "@workspace/web-design-system/data-display/widget";
import { LineChart } from "@workspace/web-design-system/charts/line-chart";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { useApiQuery } from "@/hooks/use-api-query";
import { scheduleChartUpdate } from "./monitoring-chart-slot";
import { ScoutSelect, ScoutNumber } from "./scout-controls";
import { MonitoringMetricIcon } from "./monitoring-metric-icon";
import { formatMetric } from "./monitoring-metric-chart";
import { formatDate } from "./dashboard-overview";

type DeploymentChoice = {
  id: string;
  commitSha: string | null;
  finishedAt: string | null;
  environment: string;
  previewId: string | null;
  serverId: string;
  kind: string;
};
type ComparisonMetric = {
  metric: keyof MonitoringAggregates;
  label: string;
  unit: "cores" | "bytes" | "bytesPerSecond";
  baseline: ComparisonMetricSummary;
  candidate: ComparisonMetricSummary;
  delta: number | null;
  deltaPercent: number | null;
  assessment:
    | "insufficient_data"
    | "increased"
    | "decreased"
    | "stable"
    | "informational";
};
type ComparisonSide = {
  deployment: DeploymentChoice & {
    configDigest: string | null;
    imageDigest: string | null;
  };
  startAt: string;
  endAt: string;
  windowComplete: boolean;
  historyExpired: boolean;
  restarts: number | null;
  restartCoveragePercent: number;
  points: ComparisonPoint[];
};
export type ScoutComparisonResponse = {
  workload: { id: string; name: string };
  query: {
    windowMinutes: number;
    warmupMinutes: number;
    statistic: "average" | "peak";
  };
  stepSeconds: number;
  baseline: ComparisonSide;
  candidate: ComparisonSide;
  metrics: ComparisonMetric[];
  warnings: string[];
};

export function ScoutComparison({ deployableId }: { deployableId: string }) {
  const endpoint = `/v1/core/workloads/${deployableId}`;
  const deployments = useApiQuery<{ deployments: DeploymentChoice[] }>(
    `${endpoint}/comparison-deployments`,
  );
  const [baseline, setBaseline] = useState("");
  const [candidate, setCandidate] = useState("");
  const [windowMinutes, setWindow] = useState(30);
  const [warmupMinutes, setWarmup] = useState(2);
  const [regressionPercent, setRegression] = useState(20);
  const [minimumCoveragePercent, setCoverage] = useState(80);
  const [statistic, setStatistic] = useState("average");
  const [cpuFloorCores, setCpuFloor] = useState(0.05);
  const [memoryFloorMiB, setMemoryFloor] = useState(16);
  const [applied, setApplied] = useState("");
  const comparison = useApiQuery<ScoutComparisonResponse>(
    applied ? `${endpoint}/deployment-comparison?${applied}` : null,
    undefined,
    { keepPreviousData: true },
  );
  const result = useDeferredValue(comparison.data);
  const rows = deployments.data?.deployments ?? [];
  const selectedCandidate = rows.find((d) => d.id === candidate) ?? rows[0];
  const compatible = rows.filter(
    (d) =>
      d.id !== selectedCandidate?.id &&
      d.environment === selectedCandidate?.environment &&
      d.previewId === selectedCandidate?.previewId,
  );
  const selectedBaseline =
    compatible.find((d) => d.id === baseline) ??
    compatible.find(
      (d) =>
        d.finishedAt &&
        selectedCandidate?.finishedAt &&
        d.finishedAt < selectedCandidate.finishedAt,
    ) ??
    compatible[0];
  const choice = (d: DeploymentChoice) => ({
    id: d.id,
    label: `${d.commitSha?.slice(0, 7) ?? d.id.slice(0, 8)} · ${d.environment === "preview" ? "Preview" : "Production"} · ${d.finishedAt ? formatDate(d.finishedAt) : "Unknown time"}`,
  });
  function compare(event: FormEvent) {
    event.preventDefault();
    if (!selectedBaseline || !selectedCandidate) return;
    const next = new URLSearchParams({
      baselineId: selectedBaseline.id,
      candidateId: selectedCandidate.id,
      windowMinutes: String(windowMinutes),
      warmupMinutes: String(warmupMinutes),
      regressionPercent: String(regressionPercent),
      minimumCoveragePercent: String(minimumCoveragePercent),
      statistic,
      cpuFloorCores: String(cpuFloorCores),
      memoryFloorMiB: String(memoryFloorMiB),
    }).toString();
    if (next === applied) comparison.refresh();
    else setApplied(next);
  }
  return (
    <div className="grid min-w-0 gap-6">
      <div className="grid gap-1">
        <h2 className="text-lg font-medium">Compare deployments</h2>
        <p className="max-w-3xl text-sm text-muted">
          Compare equal periods after two deployments became ready. Scout shows
          changes in resource usage; traffic and workload differences can also
          affect the result.
        </p>
      </div>
      {deployments.error ? <QueryError message={deployments.error} /> : null}
      {!deployments.data ? (
        <QueryLoading />
      ) : rows.length < 2 ? (
        <Widget>
          <Widget.Content className="grid gap-2 py-10 text-center">
            <h3 className="font-medium">Two successful deployments needed</h3>
            <p className="text-sm text-muted">
              Deploy this workload again, then compare deployments from the same
              production or preview environment. Scout must have collected
              metrics for both.
            </p>
          </Widget.Content>
        </Widget>
      ) : (
        <form onSubmit={compare} className="grid gap-5">
          <div className="grid gap-4 lg:grid-cols-2">
            <ScoutSelect
              label="Baseline"
              value={selectedBaseline?.id ?? ""}
              onChange={setBaseline}
              options={compatible.map(choice)}
            />
            <ScoutSelect
              label="Compare with"
              value={selectedCandidate?.id ?? ""}
              onChange={(id) => {
                setCandidate(id);
                setBaseline("");
              }}
              options={rows.map(choice)}
            />
          </div>
          {!selectedBaseline ? (
            <p role="status" className="text-sm text-muted">
              There is no other successful deployment in this environment.
            </p>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-3">
            <ScoutNumber
              label="Observation window (minutes)"
              value={windowMinutes}
              onChange={setWindow}
              min={5}
              max={1440}
              step={1}
            />
            <ScoutNumber
              label="Skip after readiness (minutes)"
              value={warmupMinutes}
              onChange={setWarmup}
              min={0}
              max={60}
              step={1}
            />
            <ScoutSelect
              label="Compare"
              value={statistic}
              onChange={setStatistic}
              options={[
                { id: "average", label: "Average usage" },
                { id: "peak", label: "Peak usage" },
              ]}
            />
          </div>
          <details className="rounded-xl bg-default p-4">
            <summary className="cursor-pointer text-sm font-medium">
              Comparison sensitivity
            </summary>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <ScoutNumber
                label="Minimum change (%)"
                value={regressionPercent}
                onChange={setRegression}
                min={1}
                max={500}
              />
              <ScoutNumber
                label="Minimum data coverage (%)"
                value={minimumCoveragePercent}
                onChange={setCoverage}
                min={50}
                max={100}
              />
              <ScoutNumber
                label="Minimum CPU change (cores)"
                value={cpuFloorCores}
                onChange={setCpuFloor}
                min={0}
                max={1024}
                step={0.01}
              />
              <ScoutNumber
                label="Minimum memory change (MiB)"
                value={memoryFloorMiB}
                onChange={setMemoryFloor}
                min={0}
                max={1048576}
              />
            </div>
            <p className="mt-3 text-sm text-muted">
              A CPU or memory change must exceed both the percentage and
              absolute minimum. Network and disk activity are shown for context.
            </p>
          </details>
          <div className="flex items-center gap-3">
            <Button
              type="submit"
              isDisabled={!selectedBaseline || comparison.isRefreshing}
            >
              Compare deployments
            </Button>
            <span
              role="status"
              aria-live="polite"
              className="text-sm text-muted"
            >
              {comparison.isPreviousData ? "Updating comparison…" : ""}
            </span>
          </div>
        </form>
      )}
      {comparison.error ? <QueryError message={comparison.error} /> : null}
      {applied && !comparison.data && !comparison.error ? (
        <QueryLoading />
      ) : null}
      {result ? (
        <ComparisonResults
          data={result}
          updating={comparison.isPreviousData || result !== comparison.data}
        />
      ) : null}
    </div>
  );
}

const ComparisonResults = memo(function ComparisonResults({
  data,
  updating,
}: {
  data: ScoutComparisonResponse;
  updating: boolean;
}) {
  return (
    <section
      aria-label="Deployment comparison results"
      aria-busy={updating}
      className="grid min-w-0 gap-6"
    >
      <div className="grid gap-4 lg:grid-cols-2">
        {(["baseline", "candidate"] as const).map((key) => {
          const side = data[key];
          return (
            <Widget key={key}>
              <Widget.Header>
                <Widget.Title>
                  {key === "baseline" ? "Baseline" : "Compared deployment"}
                </Widget.Title>
              </Widget.Header>
              <Widget.Content className="grid gap-2 text-sm">
                <span className="font-mono font-medium">
                  {side.deployment.commitSha?.slice(0, 12) ??
                    side.deployment.id.slice(0, 8)}
                </span>
                <span className="text-muted">
                  Ready {formatDate(side.deployment.finishedAt!)}
                </span>
                <span className="text-muted">
                  Observed {formatDate(side.startAt)} – {formatDate(side.endAt)}
                </span>
                <span>
                  Recorded restarts: {side.restarts ?? "No data"} ·{" "}
                  {Math.round(side.restartCoveragePercent ?? 0)}% coverage
                </span>
              </Widget.Content>
            </Widget>
          );
        })}
      </div>
      {data.warnings.length ? (
        <div
          role="status"
          className="grid gap-2 rounded-xl bg-default p-4 text-sm text-muted"
        >
          {data.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}
      <div className="grid min-w-0 gap-5 xl:grid-cols-2">
        {data.metrics.map((metric) => (
          <ComparisonChartSlot
            key={metric.metric}
            metric={metric}
            data={data}
          />
        ))}
      </div>
    </section>
  );
});

const assessmentLabel = {
  insufficient_data: "Insufficient data",
  increased: "Higher usage",
  decreased: "Lower usage",
  stable: "Within sensitivity",
  informational: "Activity comparison",
};
const ComparisonChartSlot = memo(function ComparisonChartSlot(props: {
  metric: ComparisonMetric;
  data: ScoutComparisonResponse;
}) {
  const element = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [snapshot, setSnapshot] = useState<typeof props>();
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(Boolean(entry?.isIntersecting)),
      { rootMargin: "100px" },
    );
    if (element.current) observer.observe(element.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    return scheduleChartUpdate(() => setSnapshot(props));
  }, [props, visible]);
  return (
    <div ref={element} className="min-w-0" aria-busy={snapshot !== props}>
      {snapshot ? (
        <ComparisonChart {...snapshot} />
      ) : (
        <Widget>
          <Widget.Header>
            <Widget.Title
              icon={<MonitoringMetricIcon metric={props.metric.metric} />}
            >
              {props.metric.label}
            </Widget.Title>
          </Widget.Header>
          <Widget.Content>
            <div className="h-[322px]" aria-label="Loading comparison chart" />
          </Widget.Content>
        </Widget>
      )}
    </div>
  );
});
function ComparisonChart({
  metric,
  data,
}: {
  metric: ComparisonMetric;
  data: ScoutComparisonResponse;
}) {
  const unit =
    metric.unit === "cores"
      ? "number"
      : metric.unit === "bytes"
        ? "bytes"
        : "rate";
  const format = (value: number | null) =>
    value === null
      ? "No data"
      : `${formatMetric(value, unit)}${metric.unit === "cores" ? " cores" : ""}`;
  const points = useMemo(() => {
    const rows = new Map<
      number,
      { offset: number; baseline: number | null; candidate: number | null }
    >();
    for (
      let offset = 0;
      offset < data.query.windowMinutes * 60;
      offset += data.stepSeconds
    )
      rows.set(offset, { offset, baseline: null, candidate: null });
    for (const side of ["baseline", "candidate"] as const)
      for (const point of data[side].points) {
        const value = point.metrics[metric.metric];
        const row = rows.get(point.offsetSeconds);
        if (row && value?.count)
          row[side] =
            data.query.statistic === "peak"
              ? value.max
              : value.sum / value.count;
      }
    return [...rows.values()];
  }, [data, metric.metric]);
  return (
    <Widget className="min-w-0">
      <Widget.Header
        endContent={
          <Chip
            size="small"
            variant={
              metric.assessment === "increased" ? "warning" : "secondary"
            }
          >
            {assessmentLabel[metric.assessment]}
          </Chip>
        }
      >
        <Widget.Title icon={<MonitoringMetricIcon metric={metric.metric} />}>
          {metric.label}
        </Widget.Title>
      </Widget.Header>
      <Widget.Content className="grid min-w-0 gap-4">
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted">Baseline</p>
            <p className="tabular-nums">
              {format(metric.baseline[data.query.statistic])}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted">Compared</p>
            <p className="tabular-nums">
              {format(metric.candidate[data.query.statistic])}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted">Change</p>
            <p className="tabular-nums">
              {metric.deltaPercent === null
                ? "—"
                : `${metric.deltaPercent > 0 ? "+" : ""}${metric.deltaPercent.toFixed(1)}%`}
            </p>
          </div>
        </div>
        <LineChart
          data={points}
          height={200}
          aria-label={`${metric.label}, baseline and compared deployment`}
        >
          <LineChart.Grid vertical={false} />
          <LineChart.XAxis
            dataKey="offset"
            type="number"
            domain={[0, data.query.windowMinutes * 60]}
            tickFormatter={(value) => `${Math.round(value / 60)}m`}
            tick={{ fill: "var(--muted)", fontSize: 11 }}
            minTickGap={35}
          />
          <LineChart.YAxis
            width="auto"
            tickMargin={4}
            tickFormatter={(value) => formatMetric(value, unit)}
            tick={{ fill: "var(--muted)", fontSize: 11 }}
          />
          <LineChart.Line
            dataKey="baseline"
            name="Baseline"
            stroke="var(--muted)"
            strokeDasharray="5 3"
            strokeWidth={1.8}
            dot={false}
            type="linear"
            connectNulls={false}
            isAnimationActive={false}
          />
          <LineChart.Line
            dataKey="candidate"
            name="Compared"
            stroke="var(--accent)"
            strokeWidth={1.8}
            dot={false}
            type="linear"
            connectNulls={false}
            isAnimationActive={false}
          />
          <LineChart.Tooltip
            content={
              <LineChart.TooltipContent
                labelFormatter={(value) =>
                  `${Math.round(Number(value) / 60)} minutes into observation`
                }
                valueFormatter={(value) => format(Number(value))}
              />
            }
          />
        </LineChart>
        <div className="flex gap-4 text-xs text-muted">
          <span>┄ Baseline</span>
          <span className="text-accent">━ Compared</span>
        </div>
        <p className="text-xs text-muted">
          Coverage: baseline {metric.baseline.coveragePercent.toFixed(0)}% ·
          compared {metric.candidate.coveragePercent.toFixed(0)}%. Gaps have no
          measurement.
        </p>
      </Widget.Content>
    </Widget>
  );
}
