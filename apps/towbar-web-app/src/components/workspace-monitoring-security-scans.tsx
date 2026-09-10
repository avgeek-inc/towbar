"use client";
import { SecondaryItems } from "./secondary-sidebar";
import { ScoutIcon } from "./scout-icons";
import { useState } from "react";
import { useQueryChoice } from "@/hooks/use-page-query";
import Link from "next/link";
import { SecurityCheckIcon } from "@hugeicons/core-free-icons";
import { Button } from "@workspace/web-design-system/buttons/button";
import { Chip } from "@workspace/web-design-system/data-display/chip";
import { Widget } from "@workspace/web-design-system/data-display/widget";
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
      header: "Affected entity",
      cell: (finding) => (
        <Link
          className="focus-visible:ring-focus inline-flex items-center rounded-sm font-medium underline underline-offset-4 outline-none focus-visible:ring-2"
          href={`/sources/${finding.sourceId}/deployments/${finding.deploymentId}`}
        >
          {finding.appName}
        </Link>
      ),
      className: "whitespace-nowrap",
    },
    {
      key: "scanned",
      header: "Scanned",
      cell: (finding) =>
        finding.scannedAt ? (
          <RelativeTime label="Scanned" value={finding.scannedAt} />
        ) : (
          "—"
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
  const cards: Array<{
    label: string;
    tone: "danger" | "warning" | "neutral";
    total: number;
  }> = [
    { label: "Critical", tone: "danger", total: summary.critical },
    { label: "High", tone: "danger", total: summary.high },
    { label: "Medium", tone: "warning", total: summary.medium },
    { label: "Low", tone: "neutral", total: summary.low },
    { label: "Unknown", tone: "neutral", total: summary.unknown },
  ];
  return (
    <section aria-label="Workspace vulnerability totals" className="grid gap-4">
      <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {cards.map((card) => (
          <Widget className="min-w-0" key={card.label}>
            <Widget.Header>
              <Widget.Title>{card.label}</Widget.Title>
            </Widget.Header>
            <Widget.Content className="flex min-h-16 items-center">
              <span
                className={
                  card.tone === "danger" && card.total > 0
                    ? "text-3xl font-semibold tracking-tight tabular-nums text-danger"
                    : card.tone === "warning" && card.total > 0
                      ? "text-3xl font-semibold tracking-tight tabular-nums text-warning"
                      : "text-3xl font-semibold tracking-tight tabular-nums"
                }
              >
                {card.total}
              </span>
            </Widget.Content>
          </Widget>
        ))}
      </div>
    </section>
  );
}

function severityVariant(severity: Severity) {
  if (severity === "critical" || severity === "high") return "destructive";
  if (severity === "medium") return "warning";
  return "secondary";
}
