"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { GitHubConnection } from "@workspace/towbar-web-client";
import { Attributes } from "@workspace/web-design-system/data-display/attributes";
import { EmptyState } from "@workspace/web-design-system/data-display/empty-state";
import { TypographyCode } from "@workspace/web-design-system/typography/typography";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { StatusBadge } from "@workspace/towbar-web-ui/status-badge";

import { ActionButton } from "@/components/page-parts";
import { refreshApiQueries, useApiQuery } from "@/hooks/use-api-query";
import { api } from "@/lib/api";

export function GitHubSettings() {
  const params = useSearchParams();
  const completed = useRef(false);
  const [callbackError, setCallbackError] = useState<string>();
  const query = useApiQuery<{ connection: GitHubConnection | null }>(
    "/v1/core/github",
  );
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
        window.history.replaceState(null, "", "/settings?section=github");
        refreshApiQueries();
      })
      .catch((error: unknown) =>
        setCallbackError(
          error instanceof Error ? error.message : "Could not connect GitHub",
        ),
      );
  }, [installationId, state]);
  if (query.error) return <QueryError message={query.error} />;
  if (!query.data) return <QueryLoading />;
  if (callbackError) return <QueryError message={callbackError} />;
  if (installationId && state) return <QueryLoading />;
  const connection = query.data.connection;
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
      </Attributes>
      <div>{action}</div>
    </div>
  ) : (
    <EmptyState className="min-h-64 justify-center">
      <EmptyState.Header>
        <EmptyState.Title>GitHub not connected</EmptyState.Title>
        <EmptyState.Description className="max-w-md text-pretty">
          Install the GitHub App and choose only the repositories Towbar should
          read. Towbar never requests write access.
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
