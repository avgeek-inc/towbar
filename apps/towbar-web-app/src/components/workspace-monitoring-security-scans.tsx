"use client";
import { SecondaryItems } from "./secondary-sidebar";
import { ScoutIcon } from "./scout-icons";
import { useState } from "react";
import { useQueryChoice } from "@/hooks/use-page-query";
import Link from "next/link";
import { SecurityCheckIcon } from "@hugeicons/core-free-icons";
import { Button } from "@workspace/web-design-system/buttons/button";
import { Chip } from "@workspace/web-design-system/data-display/chip";
import { TooltipText } from "@workspace/web-design-system/overlays/tooltip";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import {
  ResourceTable,
  type ResourceTableColumn,
} from "@workspace/towbar-web-ui/resource-table";
import { TypographyCode } from "@workspace/web-design-system/typography/typography";
import { useApiQuery } from "@/hooks/use-api-query";
import { DashboardPage } from "./page-parts";
import { RelativeTime } from "./last-synced-time";
import type {
  VulnerabilityFindingSummary,
  WorkspaceVulnerabilityFindings,
} from "@workspace/towbar-web-client";

const severityOrder = ["critical", "high", "medium", "low", "unknown"] as const;

type Severity = (typeof severityOrder)[number];

export function WorkspaceSecurityScans() {
  const [severity, setSeverity] = useQueryChoice(
    "severity",
    ["all", ...severityOrder],
    "all",
  );
  const [page, setPage] = useState(1);
  const query = useApiQuery<WorkspaceVulnerabilityFindings>(
    `/v1/core/monitoring/security-scans?severity=${severity}&page=${page}&limit=20`,
    30_000,
    { keepPreviousData: true },
  );
  const columns: ResourceTableColumn<VulnerabilityFindingSummary>[] = [
    {
      key: "advisory",
      header: "Advisory",
      cell: (finding) => <TypographyCode>{finding.advisoryId}</TypographyCode>,
      className: "whitespace-nowrap",
    },
    {
      key: "severity",
      header: "Severity",
      cell: (finding) => (
        <Chip variant={severityVariant(finding.severity)}>
          {finding.severity}
        </Chip>
      ),
      className: "whitespace-nowrap",
    },
    {
      key: "package",
      header: "Package",
      cell: (finding) => (
        <div className="grid gap-1">
          <span className="font-medium">{finding.packageName}</span>
          <span className="text-xs text-muted">
            {finding.installedVersion} →{" "}
            {finding.fixedVersion ?? "No fix available"}
          </span>
        </div>
      ),
      className: "min-w-56",
    },
    {
      key: "target",
      header: "Target",
      cell: (finding) => (
        <TooltipText
          className="block max-w-48 truncate"
          tooltip={finding.target}
        >
          {finding.target}
        </TooltipText>
      ),
    },
    {
      key: "app",
      header: "Affected app",
      cell: (finding) => (
        <div className="grid gap-1">
          <Link
            className="focus-visible:ring-focus inline-flex items-center gap-1 rounded-sm font-medium underline underline-offset-4 outline-none focus-visible:ring-2"
            href={`/sources/${finding.sourceId}/deployments/${finding.deploymentId}`}
          >
            {finding.appName}
            {finding.appArchivedAt ? (
              <span className="text-xs font-normal text-muted">Archived</span>
            ) : null}
          </Link>
          <span className="text-xs text-muted">
            {finding.sourceName ?? "—"} · {finding.serverName}
          </span>
        </div>
      ),
      className: "min-w-56",
    },
    {
      key: "scanned",
      header: "Scanned",
      cell: (finding) => (
        <div className="flex items-center gap-2 whitespace-nowrap">
          {finding.scannedAt ? (
            <RelativeTime label="Scanned" value={finding.scannedAt} />
          ) : (
            "—"
          )}
          {finding.scanState === "stale" ? (
            <Chip size="small" variant="warning">
              Stale database
            </Chip>
          ) : null}
        </div>
      ),
      className: "whitespace-nowrap",
    },
  ];
  return (
    <DashboardPage title="Security scans" icon={SecurityCheckIcon}>
      <SecondaryItems
        title="Severity"
        selected={severity}
        onSelect={(value) => {
          setSeverity(value);
          setPage(1);
        }}
        items={[
          {
            id: "all",
            label: "All severities",
            icon: <ScoutIcon name="all" />,
          },
          {
            id: "critical",
            label: "Critical",
            icon: <ScoutIcon name="critical" />,
          },
          { id: "high", label: "High", icon: <ScoutIcon name="warning" /> },
          { id: "medium", label: "Medium", icon: <ScoutIcon name="warning" /> },
          { id: "low", label: "Low", icon: <ScoutIcon name="none" /> },
          {
            id: "unknown",
            label: "Unknown",
            icon: <ScoutIcon name="unknown" />,
          },
        ]}
      />
      <div className="grid gap-5">
        {query.error ? <QueryError message={query.error} /> : null}
        {query.data ? (
          <>
            <SeveritySummary summary={query.data.summary} />
            <ResourceTable
              ariaLabel="Workspace vulnerability findings"
              columns={columns}
              getRowKey={(finding) => `${finding.appId}:${finding.id}`}
              items={query.data.findings}
              emptyTitle="No advisories in this view"
              emptyDescription="Findings from the latest scan of each App's production image appear here ranked by severity. Resources are not image-scanned."
            />
            <div className="flex items-center justify-end gap-3">
              <span className="text-sm text-muted">Page {page}</span>
              <Button
                size="sm"
                variant="secondary"
                isDisabled={page === 1 || query.isPreviousData}
                onPress={() => setPage((old) => old - 1)}
              >
                <ScoutIcon name="previous" />
                Previous
              </Button>
              <Button
                size="sm"
                variant="secondary"
                isDisabled={!query.data.nextPage || query.isPreviousData}
                onPress={() => setPage((old) => old + 1)}
              >
                <ScoutIcon name="next" />
                Next
              </Button>
            </div>
          </>
        ) : !query.error ? (
          <QueryLoading />
        ) : null}
      </div>
    </DashboardPage>
  );
}

function SeveritySummary({
  summary,
}: {
  summary: WorkspaceVulnerabilityFindings["summary"];
}) {
  const hasUnknown = summary.unknown > 0;
  return (
    <section aria-label="Workspace vulnerability totals" className="grid gap-3">
      <div
        className={`grid grid-cols-2 ${hasUnknown ? "sm:grid-cols-5" : "sm:grid-cols-4"}`}
      >
        <SeverityTotal
          label="Critical"
          total={summary.critical}
          tone="danger"
        />
        <SeverityTotal label="High" total={summary.high} tone="danger" />
        <SeverityTotal label="Medium" total={summary.medium} tone="warning" />
        <SeverityTotal label="Low" total={summary.low} tone="neutral" />
        {hasUnknown ? (
          <SeverityTotal
            label="Unknown"
            total={summary.unknown}
            tone="neutral"
          />
        ) : null}
      </div>
      <p className="text-sm text-muted">
        {summary.scansWithFindings} app
        {summary.scansWithFindings === 1 ? "" : "s"} with findings ·{" "}
        {summary.cleanScans} clean · {summary.failedScans} failed ·{" "}
        {summary.activeScans} in progress
      </p>
    </section>
  );
}

function SeverityTotal({
  label,
  tone,
  total,
}: {
  label: string;
  tone: "danger" | "warning" | "neutral";
  total: number;
}) {
  return (
    <div className="rounded-xl border border-separator p-3">
      <p className="text-xs text-muted">{label}</p>
      <p
        className={
          tone === "danger" && total > 0
            ? "text-xl font-medium tabular-nums text-danger"
            : tone === "warning" && total > 0
              ? "text-xl font-medium tabular-nums text-warning"
              : "text-xl font-medium tabular-nums"
        }
      >
        {total}
      </p>
    </div>
  );
}

function severityVariant(severity: Severity) {
  if (severity === "critical" || severity === "high") return "destructive";
  if (severity === "medium") return "warning";
  return "secondary";
}
