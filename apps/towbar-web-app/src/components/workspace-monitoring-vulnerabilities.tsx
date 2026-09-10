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
import {
  severityVariant,
  VulnerabilitySeverityWidgets,
} from "./vulnerability-severity-widgets";
import { RelativeTime } from "./last-synced-time";
import type {
  VulnerabilityFindingSummary,
  WorkspaceVulnerabilityFindings,
} from "@workspace/towbar-web-client";

const severityOrder = ["critical", "high", "medium", "low", "unknown"] as const;

export function WorkspaceVulnerabilities() {
  const [severity, setSeverity] = useQueryChoice(
    "severity",
    ["all", ...severityOrder],
    "all",
  );
  const [page, setPage] = useState(1);
  const query = useApiQuery<WorkspaceVulnerabilityFindings>(
    `/v1/core/monitoring/vulnerabilities?severity=${severity}&page=${page}&limit=20`,
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
      cell: (finding) => finding.packageName,
      className: "whitespace-nowrap",
    },
    {
      key: "installed",
      header: "Installed",
      cell: (finding) => (
        <TypographyCode>{finding.installedVersion}</TypographyCode>
      ),
      className: "whitespace-nowrap",
    },
    {
      key: "fixed",
      header: "Fixed in",
      cell: (finding) =>
        finding.fixedVersion ? (
          <TypographyCode>{finding.fixedVersion}</TypographyCode>
        ) : (
          "Not available"
        ),
      className: "whitespace-nowrap",
    },
    {
      key: "entity",
      header: "Entity",
      cell: (finding) => (
        <Link
          className="focus-visible:ring-focus hover:font-medium inline-flex items-center rounded-sm outline-none focus-visible:ring-2"
          href={`/sources/${finding.sourceId}/deployments/${finding.deploymentId}`}
        >
          {finding.appName}
        </Link>
      ),
      className: "whitespace-nowrap",
    },
    {
      key: "target",
      header: "Target",
      cell: (finding) => (
        <TooltipText tooltip={finding.target}>{finding.target}</TooltipText>
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
    <DashboardPage title="Vulnerabilities" icon={SecurityCheckIcon}>
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
            <VulnerabilitySeverityWidgets totals={query.data.summary} />
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
