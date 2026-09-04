"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type {
  GitHubConnection,
  PreviewReportingHealth,
} from "@workspace/towbar-web-client";
import { Attributes } from "@workspace/web-design-system/data-display/attributes";
import { EmptyState } from "@workspace/web-design-system/data-display/empty-state";
import { Alert } from "@workspace/web-design-system/feedback/alert";
import { TypographyCode } from "@workspace/web-design-system/typography/typography";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { StatusBadge } from "@workspace/towbar-web-ui/status-badge";

import { ActionButton } from "@/components/page-parts";
import { refreshApiQueries, useApiQuery } from "@/hooks/use-api-query";
import { api } from "@/lib/api";

export function GitHubSettings() {
  const router = useRouter();
  const params = useSearchParams();
  const completed = useRef(false);
  const [callbackError, setCallbackError] = useState<string>();
  const query = useApiQuery<{
    connection: GitHubConnection | null;
    previewReporting: PreviewReportingHealth;
  }>("/v1/core/github");
  const installationId = params.get("installation_id");
  const state = params.get("state");
  useEffect(() => {
    if (!installationId || !state || completed.current) return;
    completed.current = true;
    api
      .post("/v1/core/github/actions/complete-installation", {
        installationId,
        state,
      })
      .then(() => {
        router.replace("/manage/integrations?integration=github");
        refreshApiQueries();
      })
      .catch((error: unknown) =>
        setCallbackError(
          error instanceof Error ? error.message : "Could not connect GitHub",
        ),
      );
  }, [installationId, router, state]);
  if (query.error) return <QueryError message={query.error} />;
  if (!query.data) return <QueryLoading />;
  if (callbackError) return <QueryError message={callbackError} />;
  if (installationId && state) return <QueryLoading />;
  const connection = query.data.connection;
  const previewReporting = query.data.previewReporting;
  const previewPermissionState = connection?.permissionReadiness.status;
  const previewPermissionsReady =
    connection !== null &&
    previewPermissionState === "available" &&
    connection.permissionReadiness.preview === "ready";
  const reportingPermissionsReady = previewPermissionsReady;
  const action = connection ? (
    connection.suspendedAt ? (
      <ActionButton
        action={openGitHubInstallation}
        success="Opening GitHub"
        variant="primary"
      >
        Reconnect GitHub
      </ActionButton>
    ) : (
      <ActionButton
        action={() => api.delete("/v1/core/github")}
        confirm={{
          actionLabel: "Disconnect GitHub",
          description:
            "Existing sources will stop syncing and cannot deploy until the GitHub App is connected again.",
          title: "Disconnect the GitHub App?",
        }}
        success="GitHub disconnected"
        variant="danger"
      >
        Disconnect GitHub
      </ActionButton>
    )
  ) : (
    <ActionButton
      action={openGitHubInstallation}
      success="Opening GitHub"
      variant="primary"
    >
      Install GitHub App
    </ActionButton>
  );
  return connection ? (
    <div className="grid gap-4">
      {previewReporting.failedCount > 0 ? (
        <Alert status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Preview reporting needs retry</Alert.Title>
            <Alert.Description>
              GitHub did not receive every Preview status or pull request
              comment update. Deployments and cleanup continue independently.
              {previewReporting.lastError
                ? ` Last error: ${previewReporting.lastError}`
                : ""}
            </Alert.Description>
            <div className="mt-3">
              <ActionButton
                action={async () => {
                  const result = await api.post<{
                    attempted: number;
                    failed: number;
                    succeeded: number;
                  }>("/v1/core/github/actions/retry-preview-reporting");
                  if (result.failed > 0) {
                    throw new Error(
                      `${result.failed} Preview report${result.failed === 1 ? "" : "s"} still could not reach GitHub`,
                    );
                  }
                  return result;
                }}
                pendingLabel="Retrying…"
                success="Preview reporting retried"
              >
                Retry reporting
              </ActionButton>
            </div>
          </Alert.Content>
        </Alert>
      ) : null}
      {!connection.suspendedAt && !reportingPermissionsReady ? (
        <Alert status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>
              {previewPermissionState === "unavailable"
                ? "GitHub permissions could not be verified"
                : "GitHub reporting needs additional permissions"}
            </Alert.Title>
            <Alert.Description>
              {previewPermissionState === "unavailable"
                ? "Towbar could not confirm the installation permissions. Try again before relying on Preview status reporting."
                : "Grant Pull requests and Deployments read and write access, plus Contents read access. Towbar uses them for Preview reporting."}
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}
      <Attributes columns={2} title="GitHub connection" variant="card">
        <Attributes.Item label="Account">
          {connection.accountLogin}
        </Attributes.Item>
        <Attributes.Item label="Account type">
          {connection.accountType}
        </Attributes.Item>
        <Attributes.Item label="Installation ID">
          <TypographyCode>{connection.installationId}</TypographyCode>
        </Attributes.Item>
        <Attributes.Item label="Status">
          <StatusBadge
            status={connection.suspendedAt ? "suspended" : "active"}
          />
        </Attributes.Item>
        <Attributes.Item label="Preview reporting">
          <StatusBadge
            status={previewPermissionsReady ? "ready" : "attention"}
          />
        </Attributes.Item>
      </Attributes>
      <div className="flex flex-wrap gap-3">
        {!connection.suspendedAt && !reportingPermissionsReady ? (
          <ActionButton
            action={openGitHubInstallation}
            success="Opening GitHub"
          >
            Review permissions
          </ActionButton>
        ) : null}
        {action}
      </div>
    </div>
  ) : (
    <EmptyState>
      <EmptyState.Header>
        <EmptyState.Title>GitHub not connected</EmptyState.Title>
        <EmptyState.Description className="max-w-md text-pretty">
          Install the GitHub App and choose only the repositories Towbar should
          manage. Towbar writes Preview deployment statuses and the single
          status comment it maintains for each pull request.
        </EmptyState.Description>
      </EmptyState.Header>
      <EmptyState.Content>{action}</EmptyState.Content>
    </EmptyState>
  );
}

async function openGitHubInstallation() {
  const response = await api.post<{ url: string }>(
    "/v1/core/github/actions/installation-url",
  );
  window.location.assign(response.url);
}
