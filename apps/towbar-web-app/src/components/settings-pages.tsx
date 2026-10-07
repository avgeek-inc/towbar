"use client";
import { toast } from "@avgeek-oss/design-system/overlays/toast";
import { useAccess } from "./access-context";
import {
  ProfileSettings as LibraryProfileSettings,
  SessionsSettings,
  PasswordChangeSettings,
} from "@avgeek-oss/design-system";

import type { TowbarUser, UserSession } from "@workspace/towbar-web-client";

import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";

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
      <LibraryProfileSettings
        key={profile.data.user.name}
        value={profile.data.user.name}
        email={profile.data.user.email}
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
      <PasswordChangeSettings
        requireCurrentPassword={!user?.twoFactorEnabled}
        onChangePassword={async (values) => {
          await api.put("/v1/core/profile/password", values);
          toast.success("Password changed");
        }}
      />
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
