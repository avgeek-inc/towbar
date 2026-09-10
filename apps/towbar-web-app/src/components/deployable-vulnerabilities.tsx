"use client";
import { TooltipText } from "@workspace/web-design-system/overlays/tooltip";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import {
  ResourceTable,
  type ResourceTableColumn,
} from "@workspace/towbar-web-ui/resource-table";
import { Chip } from "@workspace/web-design-system/data-display/chip";
import { EmptyState } from "@workspace/web-design-system/data-display/empty-state";
import { TypographyCode } from "@workspace/web-design-system/typography/typography";

import { useApiQuery } from "@/hooks/use-api-query";
import { RelativeTime } from "./last-synced-time";
import {
  severityVariant,
  VulnerabilitySeverityWidgets,
} from "./vulnerability-severity-widgets";
import type {
  VulnerabilityFindingSummary,
  WorkspaceVulnerabilityFindings,
} from "@workspace/towbar-web-client";

export function DeployableVulnerabilities({
  appId,
  kind,
}: {
  appId: string;
  kind: "app" | "resource";
}) {
  const query = useApiQuery<WorkspaceVulnerabilityFindings>(
    kind === "app"
      ? `/v1/core/monitoring/vulnerabilities?appId=${appId}&limit=50`
      : null,
  );
  if (kind === "resource") {
    return (
      <EmptyState>
        <EmptyState.Header>
          <EmptyState.Title>Resources are not image-scanned</EmptyState.Title>
          <EmptyState.Description>
            Towbar scans container images for Apps. Database and image Resources
            do not receive vulnerability scans.
          </EmptyState.Description>
        </EmptyState.Header>
      </EmptyState>
    );
  }
  if (query.error) return <QueryError message={query.error} />;
  if (!query.data) return <QueryLoading />;

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
    <div className="grid min-w-0 gap-5">
      <VulnerabilitySeverityWidgets totals={query.data.summary} />
      <ResourceTable
        ariaLabel="App vulnerability findings"
        columns={columns}
        getRowKey={(finding) => `${finding.appId}:${finding.id}`}
        items={query.data.findings}
        emptyTitle="No advisories"
        emptyDescription="Findings from the latest scan of this App's production image appear here ranked by severity."
      />
    </div>
  );
}
