"use client";
import { SecondaryItems } from "./secondary-sidebar";
import { MonitoringEntityPicker } from "./monitoring-entity-picker";
import { useMonitoringSelection } from "@/hooks/use-monitoring-selection";
import { ScoutIcon } from "./scout-icons";
import { useState } from "react";
import { useQueryChoice } from "@/hooks/use-page-query";
import Link from "next/link";
import { SecurityCheckIcon } from "@hugeicons/core-free-icons";
import { Button } from "@workspace/web-design-system/buttons/button";
import { Chip } from "@workspace/web-design-system/data-display/chip";
import { Table } from "@workspace/web-design-system/data-display/table";
import { Alert } from "@workspace/web-design-system/feedback/alert";
import { Drawer } from "@workspace/web-design-system/overlays/drawer";
import { TooltipText } from "@workspace/web-design-system/overlays/tooltip";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import {
  ResourceTable,
  type ResourceTableColumn,
} from "@workspace/towbar-web-ui/resource-table";
import { StatusBadge } from "@workspace/towbar-web-ui/status-badge";
import { TypographyCode } from "@workspace/web-design-system/typography/typography";
import { useApiQuery } from "@/hooks/use-api-query";
import { DashboardPage } from "./page-parts";
import { PageSelectionTitle } from "./page-selection-title";
import { RelativeTime } from "./last-synced-time";
import type {
  VulnerabilityFinding,
  VulnerabilityScanSummary,
  VulnerabilitySeverityTotals,
  WorkspaceVulnerabilityScans,
} from "@workspace/towbar-web-client";

const severityOrder = ["critical", "high", "medium", "low", "unknown"] as const;

type Severity = (typeof severityOrder)[number];

const severityLabels: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  low: "Low",
  medium: "Medium",
  unknown: "Unknown",
};

export function WorkspaceSecurityScans() {
  const {
    kind,
    setKind,
    selected: selectedEntity,
    select: setSelectedEntity,
    entityKey,
    resolve,
  } = useMonitoringSelection();
  const [severity, setSeverity] = useQueryChoice(
    "severity",
    ["all", ...severityOrder],
    "all",
  );
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<VulnerabilityScanSummary | null>(
    null,
  );
  const entityFilter = selectedEntity
    ? selectedEntity.kind === "server"
      ? `&serverId=${selectedEntity.id}`
      : `&appId=${selectedEntity.id}`
    : "";
  const query = useApiQuery<WorkspaceVulnerabilityScans>(
    `/v1/core/monitoring/security-scans?severity=${severity}&page=${page}&limit=20${entityFilter}`,
    30_000,
    { keepPreviousData: true },
  );
  const columns: ResourceTableColumn<VulnerabilityScanSummary>[] = [
    {
      key: "app",
      header: "App",
      className: "min-w-56",
      cell: (scan) => (
        <div className="grid gap-1">
          <span className="font-medium">
            {scan.appName}
            {scan.appArchivedAt ? (
              <span className="ml-2 text-xs font-normal text-muted">
                Archived
              </span>
            ) : null}
          </span>
          <span className="text-xs text-muted">{scan.sourceName ?? "—"}</span>
        </div>
      ),
    },
    {
      key: "server",
      header: "Server",
      cell: (scan) => scan.serverName,
      className: "whitespace-nowrap",
    },
    {
      key: "severity",
      header: "Findings",
      cell: (scan) => <SeverityChips totals={scan.severityTotals} />,
      className: "min-w-64",
    },
    {
      key: "status",
      header: "Status",
      cell: (scan) => <StatusBadge status={scan.state} />,
    },
    {
      key: "scanned",
      header: "Scanned",
      cell: (scan) => (
        <RelativeTime
          label="Scanned"
          value={scan.completedAt ?? scan.requestedAt}
        />
      ),
      className: "whitespace-nowrap",
    },
    {
      key: "image",
      header: "Image digest",
      cell: (scan) => (
        <TooltipText
          className="block max-w-40 truncate"
          tooltip={scan.imageDigest}
        >
          {scan.imageDigest.replace("sha256:", "").slice(0, 12)}
        </TooltipText>
      ),
    },
    {
      key: "view",
      header: "",
      cell: (scan) => (
        <Button
          size="sm"
          variant="secondary"
          onPress={() => setSelected(scan)}
          isDisabled={
            !["findings", "stale", "failed", "clean"].includes(scan.state)
          }
        >
          <ScoutIcon name="view" />
          View scan
        </Button>
      ),
    },
  ];
  return (
    <DashboardPage
      title={
        selectedEntity
          ? `${selectedEntity.name} · Security scans`
          : "Security scans"
      }
      icon={SecurityCheckIcon}
    >
      {selectedEntity ? (
        <PageSelectionTitle
          label={`${selectedEntity.name} · Security scans`}
          icon={<ScoutIcon name={selectedEntity.kind} />}
        />
      ) : null}
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
      <MonitoringEntityPicker
        allowAll
        kind={kind}
        entityKey={entityKey}
        onResolve={resolve}
        onKindChange={(value) => {
          setKind(value);
          setPage(1);
        }}
        selected={selectedEntity}
        onSelect={(entity, replace) => {
          setSelectedEntity(entity, replace);
          setPage(1);
        }}
      />
      <div className="grid gap-5">
        {query.error ? <QueryError message={query.error} /> : null}
        {query.data ? (
          <>
            <SeveritySummary summary={query.data.summary} />
            <ResourceTable
              ariaLabel="Workspace vulnerability scans"
              columns={columns}
              getRowKey={(scan) => scan.id}
              items={query.data.scans}
              emptyTitle="No scans in this view"
              emptyDescription="Image scans for Apps with vulnerability scanning enabled appear here. Resources are not image-scanned."
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
        {selected ? (
          <SecurityScanDrawer
            scan={selected}
            onClose={() => setSelected(null)}
          />
        ) : null}
      </div>
    </DashboardPage>
  );
}

function SeverityChips({ totals }: { totals: VulnerabilitySeverityTotals }) {
  const visible = severityOrder.filter((severity) => totals[severity] > 0);
  if (!visible.length) return <span className="text-muted">No findings</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {visible.map((severity) => (
        <Chip
          key={severity}
          size="small"
          variant={
            severity === "critical" || severity === "high"
              ? "destructive"
              : severity === "medium"
                ? "warning"
                : "secondary"
          }
        >
          {totals[severity]} {severityLabels[severity]}
        </Chip>
      ))}
    </div>
  );
}

function SeveritySummary({
  summary,
}: {
  summary: WorkspaceVulnerabilityScans["summary"];
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
        {summary.scansWithFindings} scan
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

function SecurityScanDrawer({
  scan,
  onClose,
}: {
  scan: VulnerabilityScanSummary;
  onClose: () => void;
}) {
  const findingsQuery = useApiQuery<{ findings: VulnerabilityFinding[] }>(
    ["findings", "stale"].includes(scan.state)
      ? `/v1/core/deployments/${scan.deploymentId}/vulnerability-scan/findings`
      : null,
  );
  return (
    <Drawer
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Drawer.Backdrop>
        <Drawer.Content placement="right">
          <Drawer.Dialog className="w-full max-w-3xl">
            <Drawer.CloseTrigger aria-label="Close scan" />
            <Drawer.Header>
              <p className="text-sm text-muted">Image vulnerability scan</p>
              <Drawer.Heading>{scan.appName}</Drawer.Heading>
            </Drawer.Header>
            <Drawer.Body>
              <div className="grid gap-4" key={scan.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={scan.state} />
                  <span className="text-sm text-muted">
                    {scan.scannerName ?? "Scanner pending"}
                    {scan.scannerVersion ? ` ${scan.scannerVersion}` : ""}
                  </span>
                  {scan.vulnerabilityDatabaseUpdatedAt ? (
                    <span className="text-sm text-muted">
                      Database updated{" "}
                      <RelativeTime
                        label="Database updated"
                        value={scan.vulnerabilityDatabaseUpdatedAt}
                      />
                    </span>
                  ) : null}
                </div>
                {scan.state === "failed" && scan.errorMessage ? (
                  <Alert status="danger">
                    <Alert.Indicator />
                    <Alert.Content>
                      <Alert.Title>Image scan failed</Alert.Title>
                      <Alert.Description>{scan.errorMessage}</Alert.Description>
                    </Alert.Content>
                  </Alert>
                ) : null}
                {scan.state === "stale" ? (
                  <Alert status="warning">
                    <Alert.Indicator />
                    <Alert.Content>
                      <Alert.Title>
                        Results use an older vulnerability database
                      </Alert.Title>
                      <Alert.Description>
                        Run the scan again before using these findings for a
                        release decision.
                      </Alert.Description>
                    </Alert.Content>
                  </Alert>
                ) : null}
                {findingsQuery.error ? (
                  <QueryError message={findingsQuery.error} />
                ) : null}
                {findingsQuery.data?.findings.length ? (
                  <Table>
                    <Table.ScrollContainer>
                      <Table.Content aria-label="Image vulnerability findings">
                        <Table.Header>
                          <Table.Column isRowHeader>Advisory</Table.Column>
                          <Table.Column>Severity</Table.Column>
                          <Table.Column>Package</Table.Column>
                          <Table.Column>Installed</Table.Column>
                          <Table.Column>Fixed in</Table.Column>
                          <Table.Column>Target</Table.Column>
                        </Table.Header>
                        <Table.Body>
                          {findingsQuery.data.findings.map((finding) => (
                            <Table.Row id={finding.id} key={finding.id}>
                              <Table.Cell>
                                <TypographyCode>
                                  {finding.advisoryId}
                                </TypographyCode>
                              </Table.Cell>
                              <Table.Cell>
                                <Chip
                                  variant={severityVariant(finding.severity)}
                                >
                                  {finding.severity}
                                </Chip>
                              </Table.Cell>
                              <Table.Cell>{finding.packageName}</Table.Cell>
                              <Table.Cell>
                                <TypographyCode>
                                  {finding.installedVersion}
                                </TypographyCode>
                              </Table.Cell>
                              <Table.Cell>
                                {finding.fixedVersion ? (
                                  <TypographyCode>
                                    {finding.fixedVersion}
                                  </TypographyCode>
                                ) : (
                                  "Not available"
                                )}
                              </Table.Cell>
                              <Table.Cell className="max-w-80">
                                <TooltipText
                                  className="block truncate"
                                  tooltip={finding.target}
                                >
                                  {finding.target}
                                </TooltipText>
                              </Table.Cell>
                            </Table.Row>
                          ))}
                        </Table.Body>
                      </Table.Content>
                    </Table.ScrollContainer>
                  </Table>
                ) : findingsQuery.data &&
                  ["findings", "stale"].includes(scan.state) ? (
                  <p className="text-sm text-muted">
                    No actionable critical, high, or fixable package findings
                    were stored. Severity totals include every reported
                    vulnerability.
                  </p>
                ) : scan.state === "clean" ? (
                  <p className="text-sm text-muted">
                    No known vulnerabilities were reported for this immutable
                    image digest.
                  </p>
                ) : !findingsQuery.error ? (
                  <QueryLoading />
                ) : null}
              </div>
            </Drawer.Body>
            <Drawer.Footer>
              <Link
                className="focus-visible:ring-focus inline-flex items-center rounded-sm text-sm font-medium underline underline-offset-4 outline-none focus-visible:ring-2"
                href={`/sources/${scan.sourceId}/deployments/${scan.deploymentId}`}
              >
                Open deployment
              </Link>
              <Button slot="close" variant="secondary">
                <ScoutIcon name="close" />
                Close
              </Button>
            </Drawer.Footer>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  );
}

function severityVariant(severity: VulnerabilityFinding["severity"]) {
  if (severity === "critical" || severity === "high") return "destructive";
  if (severity === "medium") return "warning";
  return "secondary";
}
