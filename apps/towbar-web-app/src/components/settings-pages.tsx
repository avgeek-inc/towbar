"use client";
import { useAccess } from "./access-context";
import {
  ProfileSettings as LibraryProfileSettings,
  SessionsSettings,
} from "@avgeek-oss/design-system";

import type { TowbarUser, UserSession } from "@workspace/towbar-web-client";

import { UserAvatar as Avatar } from "@avgeek-oss/design-system/patterns/user-avatar";

import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";

import { FormCard, SimpleForm } from "@/components/page-parts";
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
      <FormCard title="Appearance">
        <div className="grid gap-3">
          <span className="text-sm font-medium">Gravatar Image</span>
          <p className="text-sm text-muted">
            Click the image to update it on Gravatar.
          </p>
          <a
            aria-label="Edit Gravatar image (opens in a new tab)"
            className="inline-flex w-fit rounded-lg focus-visible:outline-2 focus-visible:outline-focus"
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
          </a>
        </div>
      </FormCard>
      <LibraryProfileSettings
        key={profile.data.user.name}
        value={profile.data.user.name}
        label="Your Name"
        maxLength={120}
        onSave={async (displayName) => {
          await api.patch("/v1/core/profile", { displayName });
          profile.refresh();
          window.dispatchEvent(new Event("towbar:identity-changed"));
        }}
      />
    </div>
  );
}

export function EmailPasswordSettings() {
  const { user } = useAccess();
  return (
    <div className="content-grid min-w-0 lg:grid-cols-2 lg:items-start">
      <EmailSettings />
      <FormCard title="Change password">
        <SimpleForm
          fields={[
            ...(!user?.twoFactorEnabled
              ? [
                  {
                    autoComplete: "current-password",
                    label: "Current password",
                    maxLength: 1_024,
                    minLength: 15,
                    name: "currentPassword",
                    required: true,
                    type: "password",
                    variant: "secondary" as const,
                  },
                ]
              : []),
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
  return (
    <SessionsSettings
      items={query.data.sessions
        .filter((session) => !session.revokedAt)
        .map((session) => ({
          id: session.id,
          name:
            session.id === currentSessionId
              ? "This browser"
              : "Browser session",
          lastActive: session.lastSeenAt,
          expiresAt: session.expiresAt,
          current: session.id === currentSessionId,
        }))}
      formatDate={(value) => (
        <RelativeTime label="Session date" value={value} />
      )}
      onRevoke={async (id) => {
        if (id === currentSessionId)
          throw new Error("You cannot revoke your current session here.");
        await api.delete(`/v1/core/sessions/${id}`);
        query.refresh();
      }}
    />
  );
}
