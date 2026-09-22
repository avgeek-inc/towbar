"use client";

import {
  Add01Icon,
  ReloadIcon,
  Shield01Icon,
  Unlink01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
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

import { ActionButton, FormCard } from "@/components/page-parts";
import { refreshApiQueries, useApiQuery } from "@/hooks/use-api-query";
import { api } from "@/lib/api";
import { IntegrationProviderLogo } from "./integration-provider-logo";
import { RelativeTime } from "./last-synced-time";

type GitHubState = {
  configuration: {
    appId: string;
    appSlug: string;
    source: "environment";
  } | null;
  connection: GitHubConnection | null;
  previewReporting: PreviewReportingHealth;
};

export function GitHubSettings() {
  const router = useRouter();
  const params = useSearchParams();
  const completed = useRef(false);
  const [callbackError, setCallbackError] = useState<string>();
  const query = useApiQuery<GitHubState>("/v1/core/github");
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
        router.replace("/manage/integrations/github");
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
  if (!query.data.configuration)
    return (
      <QueryError message="GitHub is not configured in the Towbar environment." />
    );

  return (
    <GitHubConnectionCard
      connection={query.data.connection}
      previewReporting={query.data.previewReporting}
    />
  );
}

function GitHubConnectionCard({
  connection,
  previewReporting,
}: {
  connection: GitHubConnection | null;
  previewReporting: PreviewReportingHealth;
}) {
  const previewPermissionState = connection?.permissionReadiness.status;
  const previewPermissionsReady =
    connection !== null &&
    previewPermissionState === "available" &&
    connection.permissionReadiness.preview === "ready";
  const action = connection ? (
    connection.suspendedAt ? (
      <ActionButton
        action={createGitHubInstallation}
        pendingLabel="Opening GitHub…"
        redirectOnSuccess={(result) => result.url}
        success="Opening GitHub"
      >
        <HugeiconsIcon icon={ReloadIcon} className="size-4" />
        Reconnect GitHub
      </ActionButton>
    ) : (
      <ActionButton
        action={() => api.delete("/v1/core/github")}
        confirm={{
          actionLabel: "Disconnect GitHub",
          description:
            "Existing repositories will stop syncing and cannot deploy until the GitHub App is connected again.",
          title: "Disconnect the GitHub App?",
        }}
        success="GitHub disconnected"
        variant="danger"
      >
        <HugeiconsIcon icon={Unlink01Icon} className="size-4" />
        Disconnect GitHub
      </ActionButton>
    )
  ) : (
    <ActionButton
      action={createGitHubInstallation}
      pendingLabel="Opening GitHub…"
      redirectOnSuccess={(result) => result.url}
      success="Opening GitHub"
    >
      <HugeiconsIcon icon={Add01Icon} className="size-4" />
      Install GitHub App
    </ActionButton>
  );

  return (
    <div className="content-grid grid-cols-[repeat(auto-fill,minmax(min(28rem,100%),1fr))] items-start">
      <div className="content-grid">
        {connection && previewReporting.failedCount > 0 ? (
          <Alert status="warning">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>Preview reporting needs retry</Alert.Title>
              <Alert.Description>
                GitHub did not receive every preview status update.
                {previewReporting.lastError
                  ? ` Last error: ${previewReporting.lastError}`
                  : ""}
              </Alert.Description>
              {previewReporting.lastFailedAt ? (
                <div className="pt-2">
                  <RelativeTime
                    label="Last failed"
                    value={previewReporting.lastFailedAt}
                  />
                </div>
              ) : null}
            </Alert.Content>
          </Alert>
        ) : null}
        {connection && !connection.suspendedAt && !previewPermissionsReady ? (
          <Alert status="warning">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>
                {previewPermissionState === "unavailable"
                  ? "GitHub permissions could not be verified"
                  : "GitHub reporting needs additional permissions"}
              </Alert.Title>
              <Alert.Description>
                Grant Pull requests and Deployments read and write access, plus
                Contents read access.
              </Alert.Description>
            </Alert.Content>
          </Alert>
        ) : null}
        <FormCard
          headerEnd={
            <StatusBadge
              status={
                connection?.suspendedAt
                  ? "suspended"
                  : connection
                    ? "active"
                    : "not_configured"
              }
            />
          }
          icon={<IntegrationProviderLogo provider="github" />}
          title="GitHub connection"
        >
          {connection ? (
            <div className="content-grid">
              <Attributes columns={1} variant="embedded">
                <Attributes.Item label="Account">
                  {connection.accountLogin}
                </Attributes.Item>
                <Attributes.Item label="Account type">
                  {connection.accountType}
                </Attributes.Item>
                <Attributes.Item label="Installation ID">
                  <TypographyCode>{connection.installationId}</TypographyCode>
                </Attributes.Item>
                <Attributes.Item label="Preview reporting">
                  <StatusBadge
                    status={previewPermissionsReady ? "ready" : "attention"}
                  />
                </Attributes.Item>
              </Attributes>
              <div className="flex flex-wrap gap-3">
                {!connection.suspendedAt && !previewPermissionsReady ? (
                  <ActionButton
                    action={createGitHubInstallation}
                    pendingLabel="Opening GitHub…"
                    redirectOnSuccess={(result) => result.url}
                    success="Opening GitHub"
                  >
                    <HugeiconsIcon icon={Shield01Icon} className="size-4" />
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
                  Install the environment-configured GitHub App and choose the
                  repositories Towbar should manage.
                </EmptyState.Description>
              </EmptyState.Header>
              <EmptyState.Content>{action}</EmptyState.Content>
            </EmptyState>
          )}
        </FormCard>
      </div>
    </div>
  );
}

async function createGitHubInstallation() {
  return await api.post<{ url: string }>(
    "/v1/core/github/actions/installation-url",
  );
}
