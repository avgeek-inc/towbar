"use client";
import { Rocket01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Widget } from "@workspace/web-design-system/data-display/widget";
import { StatusBadge } from "@workspace/towbar-web-ui/status-badge";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { useApiQuery } from "@/hooks/use-api-query";
import { api } from "@/lib/api";
import { useAccess } from "./access-context";
import { ActionButton } from "./page-parts";
import { EnvironmentChip } from "./environment-chip";
type Environment = {
  id: string;
  name: string;
  branch: string;
  mappingRevision: string;
  autoDeployPaused: boolean;
  disconnectedAt: string | null;
};
export function EnvironmentAutomationControls({
  sourceId,
}: {
  sourceId: string;
}) {
  const query = useApiQuery<{ environments: Environment[] }>(
    `/v1/core/sources/${sourceId}/environments`,
  );
  const { can } = useAccess();
  if (query.error) return <QueryError message={query.error} />;
  if (!query.data) return <QueryLoading />;
  const environments = query.data.environments.filter(
    (environment) => !environment.disconnectedAt,
  );
  return (
    <Widget>
      <Widget.Header>
        <Widget.Title icon={<HugeiconsIcon icon={Rocket01Icon} />}>
          Environment automation
        </Widget.Title>
      </Widget.Header>
      <Widget.Content>
        <div className="divide-y divide-separator">
          {environments.map((environment) => (
            <div
              key={environment.id}
              className="flex flex-wrap items-center justify-between gap-4 py-4 first:pt-0 last:pb-0"
            >
              <div className="grid justify-items-start gap-1">
                <EnvironmentChip name={environment.name} />
                <span className="text-sm text-muted">{environment.branch}</span>
              </div>
              <div className="flex items-center gap-3">
                <StatusBadge
                  status={environment.autoDeployPaused ? "pending" : "healthy"}
                  label={environment.autoDeployPaused ? "Paused" : "Enabled"}
                />
                {can("deployment.create") ? (
                  <ActionButton
                    variant="secondary"
                    success={
                      environment.autoDeployPaused
                        ? "Runtime automation enabled"
                        : "Runtime automation paused"
                    }
                    action={async () => {
                      await api.patch(
                        `/v1/core/sources/${sourceId}/environments/${environment.id}/auto-deploy-control`,
                        {
                          expectedRevision: environment.mappingRevision,
                          paused: !environment.autoDeployPaused,
                        },
                      );
                      query.refresh();
                    }}
                  >
                    {environment.autoDeployPaused ? "Enable" : "Pause"}
                  </ActionButton>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </Widget.Content>
      <Widget.Footer>
        Changing a branch mapping or syncing inventory as a Member pauses
        deployment, preview, and scheduled backup automation. An Admin can
        enable it after reviewing the current mapping.
      </Widget.Footer>
    </Widget>
  );
}
