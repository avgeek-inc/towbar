import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  type ComparisonPoint,
  type DeploymentComparisonQuery,
  type MonitoringAggregates,
  compareMetricSummaries,
  comparisonMetrics,
  deploymentComparisonQuerySchema,
  summarizeComparisonMetric,
} from "@workspace/towbar-core";
import {
  apps,
  deployments,
  monitoringAgents,
} from "@workspace/towbar-database/schema";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { badRequest, notFound } from "../../http/errors.js";

export async function listComparisonDeployments(input: {
  deployableId: string;
  workspaceId: string;
}) {
  const db = getTowbarDatabase();
  const [workload] = await db
    .select({ id: apps.id })
    .from(apps)
    .where(
      and(
        eq(apps.id, input.deployableId),
        eq(apps.workspaceId, input.workspaceId),
        isNull(apps.archivedAt),
      ),
    )
    .limit(1);
  if (!workload) throw notFound("Workload");
  return db
    .select({
      id: deployments.id,
      commitSha: deployments.commitSha,
      finishedAt: deployments.finishedAt,
      environment: deployments.environment,
      targetEnvironment: deployments.targetEnvironment,
      previewId: deployments.previewEnvironmentId,
      serverId: deployments.serverId,
      kind: deployments.kind,
    })
    .from(deployments)
    .where(
      and(
        eq(deployments.workspaceId, input.workspaceId),
        eq(deployments.appId, input.deployableId),
        eq(deployments.state, "succeeded"),
      ),
    )
    .orderBy(desc(deployments.finishedAt), desc(deployments.id))
    .limit(100);
}

export async function getDeploymentComparison(
  input: Pick<DeploymentComparisonQuery, "baselineId" | "candidateId"> &
    Partial<DeploymentComparisonQuery> & {
      deployableId: string;
      workspaceId: string;
    },
  now = new Date(),
) {
  const query = deploymentComparisonQuerySchema.parse({
    baselineId: input.baselineId,
    candidateId: input.candidateId,
    windowMinutes: input.windowMinutes,
    warmupMinutes: input.warmupMinutes,
    regressionPercent: input.regressionPercent,
    minimumCoveragePercent: input.minimumCoveragePercent,
    statistic: input.statistic,
    cpuFloorCores: input.cpuFloorCores,
    memoryFloorMiB: input.memoryFloorMiB,
  });
  const db = getTowbarDatabase();
  const [workload] = await db
    .select({ name: apps.name })
    .from(apps)
    .where(
      and(
        eq(apps.id, input.deployableId),
        eq(apps.workspaceId, input.workspaceId),
        isNull(apps.archivedAt),
      ),
    )
    .limit(1);
  if (!workload) throw notFound("Workload");
  const candidates = await db
    .select()
    .from(deployments)
    .where(
      and(
        eq(deployments.workspaceId, input.workspaceId),
        eq(deployments.appId, input.deployableId),
        inArray(deployments.id, [query.baselineId, query.candidateId]),
      ),
    );
  const baseline = candidates.find((d) => d.id === query.baselineId),
    candidate = candidates.find((d) => d.id === query.candidateId);
  if (!baseline || !candidate) throw notFound("Deployment");
  if (
    baseline.state !== "succeeded" ||
    candidate.state !== "succeeded" ||
    !baseline.finishedAt ||
    !candidate.finishedAt
  )
    throw badRequest(
      "Compare two successful deployments with a recorded completion time",
    );
  if (
    baseline.environment !== candidate.environment ||
    baseline.previewEnvironmentId !== candidate.previewEnvironmentId
  )
    throw badRequest(
      "Choose deployments in the same production or preview environment",
    );
  const windowSeconds = query.windowMinutes * 60;
  const stepSeconds = Math.max(60, Math.ceil(windowSeconds / 240 / 60) * 60);
  const analyze = async (deployment: typeof deployments.$inferSelect) => {
    const start = new Date(
      deployment.finishedAt!.getTime() + query.warmupMinutes * 60_000,
    );
    const end = new Date(start.getTime() + windowSeconds * 1000);
    const [agent] = await db
      .select({ days: monitoringAgents.retentionDays })
      .from(monitoringAgents)
      .where(eq(monitoringAgents.serverId, deployment.serverId))
      .limit(1);
    const cutoff = new Date(now.getTime() - (agent?.days ?? 15) * 86400_000);
    const filterFrom = (from: Date) =>
      sql`server_id=${deployment.serverId}::uuid and deployable_id=${input.deployableId}::uuid and deployment_id=${deployment.id}::uuid and bucket_at>=${from.toISOString()}::timestamptz and bucket_at>=${cutoff.toISOString()}::timestamptz and bucket_at+resolution*interval '1 second'<=${end.toISOString()}::timestamptz and bucket_at+resolution*interval '1 second'<=${now.toISOString()}::timestamptz`;
    const filter = filterFrom(start);
    const rows = await db.execute<{
      offset_seconds: number;
      metrics: MonitoringAggregates;
    }>(sql`
      with expected as (
        select bucket_at,count(*) containers from towbar_monitoring_samples where ${filter} group by bucket_at
      ), slots as (
        select bucket_at,m.key,
          sum((m.value->>'sum')::double precision/nullif((m.value->>'count')::integer,0)) value,
          sum((m.value->>'max')::double precision) maximum,
          min((m.value->>'count')::integer) samples
        from towbar_monitoring_samples cross join lateral jsonb_each(metrics) m
        where ${filter} and m.key in ('cpuCores','memoryUsedBytes','networkRxBytesPerSecond','networkTxBytesPerSecond','diskReadBytesPerSecond','diskWriteBytesPerSecond')
        group by bucket_at,m.key having count(*)=(select containers from expected e where e.bucket_at=towbar_monitoring_samples.bucket_at) and bool_and(coalesce((m.value->>'count')::integer,0)>0)
      ), grouped as (
        select floor(extract(epoch from (bucket_at-${start.toISOString()}::timestamptz))/${stepSeconds})*${stepSeconds} offset_seconds,key,
          sum(value*samples) total,sum(samples) samples,min(value) minimum,max(maximum) maximum
        from slots group by offset_seconds,key
      ) select offset_seconds::integer,jsonb_object_agg(key,jsonb_build_object('sum',total,'count',samples,'min',minimum,'max',maximum)) metrics
      from grouped group by offset_seconds order by offset_seconds limit 241`);
    const points: ComparisonPoint[] = rows.map((row) => ({
      offsetSeconds: row.offset_seconds,
      metrics: row.metrics,
    }));
    const [restart] = await db.execute<{
      total: number | null;
      samples: number;
    }>(sql`
      with counters as (
        select entity_id,bucket_at,(metrics->'restartCount'->>'max')::integer value,
          (metrics->'restartCount'->>'count')::integer samples,
          lag((metrics->'restartCount'->>'max')::integer) over(partition by entity_id order by bucket_at) previous,
          lag(bucket_at) over(partition by entity_id order by bucket_at) previous_at
        from towbar_monitoring_samples where ${filterFrom(new Date(start.getTime() - 90_000))}
      ), slots as (
        select bucket_at,sum(greatest(0,value-previous)) filter(where bucket_at-previous_at<=interval '90 seconds' and previous is not null) total,
          max(samples) filter(where value is not null and previous is not null and bucket_at-previous_at<=interval '90 seconds') samples
        from counters where bucket_at>=${start.toISOString()}::timestamptz group by bucket_at
      ) select sum(total)::integer total,coalesce(sum(samples),0)::integer samples from slots`);
    return {
      deployment: {
        id: deployment.id,
        commitSha: deployment.commitSha,
        serverId: deployment.serverId,
        environment: deployment.environment,
        kind: deployment.kind,
        finishedAt: deployment.finishedAt!.toISOString(),
        configDigest: deployment.configDigest,
        imageDigest: deployment.imageDigest,
      },
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      windowComplete: end <= now,
      historyExpired: start < cutoff,
      restarts: restart?.total ?? null,
      restartCoveragePercent: Math.min(
        100,
        (((restart?.samples ?? 0) * 30) / windowSeconds) * 100,
      ),
      points,
    };
  };
  const [before, after] = await Promise.all([
    analyze(baseline),
    analyze(candidate),
  ]);
  const metrics = comparisonMetrics.map((definition) => ({
    ...definition,
    ...compareMetricSummaries(
      summarizeComparisonMetric(
        before.points,
        definition.metric,
        windowSeconds,
      ),
      summarizeComparisonMetric(after.points, definition.metric, windowSeconds),
      {
        ...query,
        ...definition,
        absoluteFloor:
          definition.metric === "cpuCores"
            ? query.cpuFloorCores
            : definition.metric === "memoryUsedBytes"
              ? query.memoryFloorMiB * 1024 ** 2
              : definition.absoluteFloor,
      },
    ),
  }));
  return {
    workload: { id: input.deployableId, name: workload.name },
    query,
    stepSeconds,
    baseline: before,
    candidate: after,
    metrics,
    restarts: {
      baseline: before.restarts,
      candidate: after.restarts,
      assessment:
        before.restartCoveragePercent < query.minimumCoveragePercent ||
        after.restartCoveragePercent < query.minimumCoveragePercent ||
        before.restarts === null ||
        after.restarts === null
          ? "insufficient_data"
          : after.restarts > before.restarts
            ? "increased"
            : after.restarts < before.restarts
              ? "decreased"
              : "stable",
    },
    warnings: [
      ...(query.statistic === "peak"
        ? [
            "Peaks sum each container’s maximum within a reporting interval. These maxima may not have occurred at the same instant.",
          ]
        : []),
      ...(!before.windowComplete || !after.windowComplete
        ? [
            "The selected observation window is still collecting data. Coverage is measured against the full requested window.",
          ]
        : []),
      ...(before.historyExpired || after.historyExpired
        ? [
            "Some of the selected history is outside retention and cannot be recovered.",
          ]
        : []),
      ...(baseline.serverId !== candidate.serverId
        ? [
            "These deployments ran on different servers. Hardware and competing workloads can affect the comparison.",
          ]
        : []),
      ...(baseline.configDigest !== candidate.configDigest
        ? ["Workload configuration changed between these deployments."]
        : []),
      "Resource usage changes can reflect traffic or other workload differences; they do not establish that a deployment caused a regression.",
    ],
  };
}
