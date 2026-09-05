"use client";

import type { TowbarUser, UserSession } from "@workspace/towbar-web-client";
import { Button } from "@workspace/web-design-system/buttons/button";
import { TypographyCode } from "@workspace/web-design-system/typography/typography";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import {
  ResourceTable,
  type ResourceTableColumn,
} from "@workspace/towbar-web-ui/resource-table";
import { StatusBadge } from "@workspace/towbar-web-ui/status-badge";

import { ActionButton, FormCard, SimpleForm } from "@/components/page-parts";
import { useApiQuery } from "@/hooks/use-api-query";
import { api } from "@/lib/api";
import { formatDate } from "./dashboard-overview";

export function ProfileSettings() {
  const profile = useApiQuery<{ user: TowbarUser }>("/v1/core/profile");
  if (profile.error) return <QueryError message={profile.error} />;
  if (!profile.data) return <QueryLoading />;

  return (
    <div className="content-grid min-w-0 lg:grid-cols-2 lg:items-start">
      <FormCard
        headerEnd={
          <span className="truncate text-xs text-muted">
            {profile.data.user.email}
          </span>
        }
        title="Profile details"
      >
        <SimpleForm
          fields={[
            {
              label: "Display name",
              maxLength: 120,
              name: "displayName",
              defaultValue: profile.data.user.name,
              required: true,
              variant: "secondary",
            },
          ]}
          onSubmit={async (values) => {
            await api.patch("/v1/core/profile", values);
          }}
          successMessage="Profile updated"
          submitLabel="Update profile"
        />
      </FormCard>
      <FormCard title="Change password">
        <SimpleForm
          fields={[
            {
              autoComplete: "current-password",
              label: "Current password",
              maxLength: 1_024,
              minLength: 12,
              name: "currentPassword",
              required: true,
              type: "password",
              variant: "secondary",
            },
            {
              autoComplete: "new-password",
              description: "Use at least 12 characters.",
              label: "New password",
              maxLength: 1_024,
              minLength: 12,
              name: "newPassword",
              required: true,
              type: "password",
              variant: "secondary",
            },
            {
              autoComplete: "new-password",
              label: "Confirm new password",
              maxLength: 1_024,
              minLength: 12,
              name: "confirmPassword",
              required: true,
              type: "password",
              variant: "secondary",
            },
          ]}
          onSubmit={async (values) => {
            if (values.newPassword !== values.confirmPassword) {
              throw new Error("New passwords do not match");
            }
            await api.put("/v1/core/profile/password", values);
          }}
          successMessage="Password changed"
          submitLabel="Change password"
        />
      </FormCard>
    </div>
  );
}

export function SessionSettings() {
  const query = useApiQuery<{
    currentSessionId: string;
    sessions: UserSession[];
  }>("/v1/core/sessions");
  if (query.error) return <QueryError message={query.error} />;
  if (!query.data) return <QueryLoading variant="table" />;

  const { currentSessionId } = query.data;
  const sessions = query.data.sessions.filter((session) => !session.revokedAt);
  const columns: ResourceTableColumn<UserSession>[] = [
    {
      key: "session",
      header: "Session",
      cell: (session) =>
        session.id === currentSessionId ? "This browser" : "Browser session",
      className: "min-w-40",
    },
    {
      key: "sessionId",
      header: "Session ID",
      cell: (session) => (
        <TypographyCode title={session.id}>
          {session.id.slice(0, 8)}
        </TypographyCode>
      ),
      className: "min-w-36",
    },
    {
      key: "lastActive",
      header: "Last active",
      cell: (session) => formatDate(session.lastSeenAt),
      className: "whitespace-nowrap",
    },
    {
      key: "expires",
      header: "Expires",
      cell: (session) => formatDate(session.expiresAt),
      className: "whitespace-nowrap",
    },
    {
      key: "status",
      header: "Status",
      cell: (session) =>
        session.id === currentSessionId ? (
          <StatusBadge status="current" />
        ) : (
          <StatusBadge status="active" />
        ),
    },
    {
      key: "actions",
      header: "Actions",
      headerClassName: "text-end",
      className: "text-end",
      cell: (session) =>
        session.id === currentSessionId ? (
          <Button isDisabled variant="danger">
            Revoke
          </Button>
        ) : (
          <ActionButton
            action={() => api.delete(`/v1/core/sessions/${session.id}`)}
            confirm={{
              actionLabel: "Revoke session",
              description:
                "That browser will lose access immediately and must sign in again.",
              title: "Revoke this session?",
            }}
            success="Session revoked"
            variant="danger"
          >
            Revoke
          </ActionButton>
        ),
    },
  ];

  return (
    <ResourceTable
      ariaLabel="Active browser sessions"
      columns={columns}
      emptyDescription="Sign in to create a browser session."
      emptyTitle="No active sessions"
      getRowKey={(session) => session.id}
      items={sessions}
    />
  );
}
