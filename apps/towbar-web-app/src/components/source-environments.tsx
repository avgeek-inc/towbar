"use client";
import {
  GitBranchIcon,
  Unlink01Icon,
  Link01Icon,
  Cancel01Icon,
  ReloadIcon,
  Settings01Icon,
  FloppyDiskIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { ResourceTable } from "@workspace/towbar-web-ui/resource-table";
import { StatusBadge } from "@workspace/towbar-web-ui/status-badge";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { Button } from "@workspace/web-design-system/buttons/button";
import { Input } from "@workspace/web-design-system/forms/input";
import { Field, FieldLabel } from "@workspace/web-design-system/forms/field";
import { toast } from "@workspace/web-design-system/overlays/toast";
import { TypographyCode } from "@workspace/web-design-system/typography/typography";
import { SourceEnvironmentConnect } from "./source-environment-connect";
import { RelativeTime } from "./last-synced-time";
import { ActionButton, FormCard } from "./page-parts";
import { useApiQuery, refreshApiQueries } from "@/hooks/use-api-query";
import { api } from "@/lib/api";

export type SourceEnvironment = {
  id: string;
  name: string;
  branch: string;
  mappingRevision: string;
  previewsEnabled: boolean;
  latestSyncStatus: "never" | "queued" | "running" | "succeeded" | "failed";
  latestSyncFinishedAt: string | null;
  latestSuccessfulSyncId: string | null;
  disconnectedAt: string | null;
};

export function SourceEnvironments({
  sourceId,
  canManage,
}: {
  sourceId: string;
  canManage: boolean;
}) {
  const endpoint = `/v1/core/sources/${sourceId}/environments`;
  const query = useApiQuery<{ environments: SourceEnvironment[] }>(
    endpoint,
    5000,
  );
  const [editing, setEditing] = useState<SourceEnvironment | null>(null);
  const [branch, setBranch] = useState("");
  const [busy, setBusy] = useState(false);
  if (query.error && !query.data) return <QueryError message={query.error} />;
  if (!query.data) return <QueryLoading />;
  return (
    <div className="content-grid">
      {canManage ? <SourceEnvironmentConnect sourceId={sourceId} /> : null}
      <ResourceTable
        ariaLabel="Source environments"
        items={query.data.environments}
        getRowKey={(item) => item.id}
        emptyTitle="No environments connected"
        emptyDescription="Connect an environment declared in towbar.yml to start syncing."
        columns={[
          { key: "name", header: "Environment", cell: (item) => item.name },
          {
            key: "branch",
            header: "Branch",
            cell: (item) => <TypographyCode>{item.branch}</TypographyCode>,
          },
          {
            key: "previews",
            header: "PR previews",
            cell: (item) => (
              <StatusBadge
                status={
                  item.previewsEnabled && !item.disconnectedAt
                    ? "enabled"
                    : "disabled"
                }
              />
            ),
          },
          {
            key: "configuration",
            header: "Configuration",
            cell: (item) => (
              <StatusBadge
                status={
                  item.disconnectedAt
                    ? "disconnected"
                    : item.latestSyncStatus === "succeeded"
                      ? "synced"
                      : item.latestSyncStatus === "never"
                        ? "pending"
                        : item.latestSyncStatus
                }
              />
            ),
          },
          {
            key: "lastSynced",
            header: "Last sync",
            cell: (item) =>
              item.latestSyncFinishedAt ? (
                <RelativeTime
                  label="Last sync"
                  value={item.latestSyncFinishedAt}
                />
              ) : (
                "—"
              ),
          },
          {
            key: "actions",
            header: "Actions",
            cell: (item) =>
              canManage && !item.disconnectedAt ? (
                <div className="flex flex-wrap gap-2">
                  <ActionButton
                    action={() => api.post(`${endpoint}/${item.id}/syncs`)}
                    success={`${item.name} sync queued`}
                    pendingLabel="Queueing…"
                  >
                    <HugeiconsIcon
                      icon={ReloadIcon}
                      aria-hidden="true"
                      className="size-4"
                    />
                    Sync
                  </ActionButton>
                  <Button
                    variant="secondary"
                    onPress={() => {
                      setEditing(item);
                      setBranch(item.branch);
                    }}
                  >
                    <HugeiconsIcon
                      icon={Settings01Icon}
                      aria-hidden="true"
                      className="size-4"
                    />
                    Edit branch
                  </Button>
                  <ActionButton
                    action={() =>
                      api.delete(`${endpoint}/${item.id}`, {
                        expectedRevision: item.mappingRevision,
                      })
                    }
                    confirm={{
                      title: `Disconnect ${item.name}?`,
                      actionLabel: "Disconnect environment",
                      description:
                        "This stops synchronization and automatic deployments for this environment. Running workloads, stored secrets, deployment history and resource data are preserved.",
                    }}
                    pendingLabel="Disconnecting…"
                    success={`${item.name} disconnected`}
                    variant="danger"
                  >
                    <HugeiconsIcon
                      icon={Unlink01Icon}
                      aria-hidden="true"
                      className="size-4"
                    />
                    Disconnect
                  </ActionButton>
                </div>
              ) : canManage && item.disconnectedAt ? (
                <ActionButton
                  action={() =>
                    api.post(endpoint, {
                      environment: item.name,
                      branch: item.branch,
                    })
                  }
                  confirm={{
                    title: `Reconnect ${item.name}?`,
                    actionLabel: "Reconnect environment",
                    description: `Towbar will validate and sync ${item.branch} without deploying. Existing secrets and workload data are retained.`,
                  }}
                  pendingLabel="Reconnecting…"
                  success={`${item.name} reconnected; sync queued`}
                >
                  <HugeiconsIcon
                    icon={Link01Icon}
                    aria-hidden="true"
                    className="size-4"
                  />
                  Reconnect
                </ActionButton>
              ) : null,
          },
        ]}
      />
      {editing ? (
        <FormCard
          title={`${editing.name} branch`}
          icon={<HugeiconsIcon icon={GitBranchIcon} />}
        >
          <form
            className="content-grid"
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              try {
                await api.patch(`${endpoint}/${editing.id}`, {
                  branch,
                  expectedRevision: editing.mappingRevision,
                });
                toast.success("Branch saved; sync queued");
                setEditing(null);
                refreshApiQueries();
              } catch (error) {
                toast.danger("Couldn't save branch", {
                  description:
                    error instanceof Error
                      ? error.message
                      : "The request failed",
                });
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field>
              <FieldLabel htmlFor="environment-branch">
                Deployment branch
              </FieldLabel>
              <Input
                id="environment-branch"
                required
                value={branch}
                onChange={(event) => setBranch(event.target.value)}
                variant="secondary"
              />
            </Field>
            <p className="text-xs text-muted">
              Saving syncs configuration from this branch without deploying.
            </p>
            <div className="flex gap-2">
              <Button type="submit" isDisabled={busy || !branch.trim()}>
                <HugeiconsIcon
                  icon={FloppyDiskIcon}
                  aria-hidden="true"
                  className="size-4"
                />
                Save and sync
              </Button>
              <Button
                variant="secondary"
                onPress={() => setEditing(null)}
                isDisabled={busy}
              >
                <HugeiconsIcon
                  icon={Cancel01Icon}
                  aria-hidden="true"
                  className="size-4"
                />
                Cancel
              </Button>
            </div>
          </form>
        </FormCard>
      ) : null}
    </div>
  );
}
