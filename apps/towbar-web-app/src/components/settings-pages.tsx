"use client";
import { FieldDescription } from "@workspace/web-design-system/forms/field";
import {
  Key01Icon,
  Logout01Icon,
  UserAccountIcon,
} from "@hugeicons/core-free-icons";

import { HugeiconsIcon } from "@hugeicons/react";

import type { TowbarUser, UserSession } from "@workspace/towbar-web-client";
import { Button } from "@workspace/web-design-system/buttons/button";
import { Avatar } from "@workspace/web-design-system/data-display/avatar";
import { NewTabIndicator } from "@workspace/web-design-system/navigation/new-tab-indicator";
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
import { EmailSettings } from "./email-settings";
import { RelativeTime } from "./last-synced-time";

export function ProfileSettings() {
  const profile = useApiQuery<{ user: TowbarUser }>("/v1/core/profile");
  if (profile.error) return <QueryError message={profile.error} />;
  if (!profile.data) return <QueryLoading />;

  return (
    <div className="content-grid min-w-0 lg:grid-cols-2 lg:items-start">
      <FormCard
        icon={<HugeiconsIcon icon={UserAccountIcon} />}
        title="Appearance"
      >
        <div className="grid gap-5">
          <div className="grid gap-3">
            <div className="grid gap-0.5">
              <span className="text-sm font-medium">Gravatar Image</span>
              <FieldDescription>
                Click the image to update it on Gravatar.
              </FieldDescription>
            </div>
            <a
              aria-label="Edit Gravatar image (opens in a new tab)"
              className="inline-flex w-fit items-center rounded-lg transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
              href="https://gravatar.com/profile/avatars"
              rel="noopener noreferrer"
              target="_blank"
            >
              <Avatar
                aria-hidden="true"
                email={profile.data.user.email}
                name={profile.data.user.name}
                size="md"
              />
              <NewTabIndicator />
            </a>
          </div>
          <SimpleForm
            fields={[
              {
                label: "Full name",
                maxLength: 120,
                name: "displayName",
                defaultValue: profile.data.user.name,
                required: true,
                variant: "secondary",
              },
            ]}
            onSubmit={async (values) => {
              await api.patch("/v1/core/profile", values);
              window.dispatchEvent(new Event("towbar:identity-changed"));
            }}
            successMessage="Profile updated"
            submitLabel="Update"
          />
        </div>
      </FormCard>
    </div>
  );
}

export function EmailPasswordSettings() {
  return (
    <div className="content-grid min-w-0 lg:grid-cols-2 lg:items-start">
      <EmailSettings />
      <FormCard
        icon={<HugeiconsIcon icon={Key01Icon} />}
        title="Change password"
      >
        <SimpleForm
          fields={[
            {
              autoComplete: "current-password",
              label: "Current password",
              maxLength: 1_024,
              minLength: 15,
              name: "currentPassword",
              required: true,
              type: "password",
              variant: "secondary",
            },
            {
              autoComplete: "new-password",
              description: "Use at least 15 characters.",
              label: "New password",
              maxLength: 1_024,
              minLength: 15,
              name: "newPassword",
              required: true,
              type: "password",
              variant: "secondary",
            },
            {
              autoComplete: "new-password",
              label: "Confirm new password",
              maxLength: 1_024,
              minLength: 15,
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
      cell: (session) => (
        <RelativeTime label="Last active" value={session.lastSeenAt} />
      ),
      className: "whitespace-nowrap",
    },
    {
      key: "expires",
      header: "Expires",
      cell: (session) => (
        <RelativeTime label="Expires" value={session.expiresAt} />
      ),
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
            <HugeiconsIcon
              aria-hidden="true"
              icon={Logout01Icon}
              className="shrink-0"
            />
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
            <HugeiconsIcon
              aria-hidden="true"
              icon={Logout01Icon}
              className="shrink-0"
            />
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
