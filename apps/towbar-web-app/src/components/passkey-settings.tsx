"use client";
import { useState } from "react";
import { PasskeySettings as LibraryPasskeySettings } from "@avgeek-oss/design-system";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { useAccess } from "./access-context";
import { refreshApiQueries, useApiQuery } from "@/hooks/use-api-query";
import { api } from "@/lib/api";
import { displayDate } from "@/lib/date-time-display";
import { registerPasskey, passkeyError } from "@/lib/passkeys";

type Passkey = { id: string; name: string | null; createdAt: string };
export function PasskeySettings() {
  const { user } = useAccess();
  const keys = useApiQuery<{ passkeys: Passkey[] }>(
    "/v1/core/profile/passkeys",
  );
  const [codes, setCodes] = useState<string[]>([]);
  function changed() {
    refreshApiQueries();
    keys.refresh();
    window.dispatchEvent(new Event("towbar:identity-changed"));
  }
  if (keys.error) return <QueryError message={keys.error} />;
  if (!keys.data) return <QueryLoading />;
  return (
    <LibraryPasskeySettings
      items={keys.data.passkeys.map((key) => ({
        ...key,
        name: key.name || "Passkey",
      }))}
      formatDate={displayDate}
      maxNameLength={120}
      onAdd={async (name) => {
        if (!user) throw new Error("Sign in to add a passkey.");
        try {
          const result = await registerPasskey(name, user.email);
          if (result.recoveryCodes) setCodes(result.recoveryCodes);
        } catch (error) {
          throw new Error(passkeyError(error));
        }
        changed();
      }}
      onRename={async (id, name) => {
        await api.post("/v1/public/auth/identity/passkey/update-passkey", {
          id,
          name,
        });
        changed();
      }}
      onRemove={async (id) => {
        await api.post("/v1/public/auth/identity/passkey/delete-passkey", {
          id,
        });
        changed();
      }}
      onReplaceRecoveryCodes={async () => {
        const result = await api.post<{ recoveryCodes: string[] }>(
          "/v1/core/profile/passkeys/recovery-codes",
          {},
        );
        setCodes(result.recoveryCodes);
      }}
      recoveryCodes={codes}
      recoveryCodesFilename="towbar-recovery-codes.txt"
      onDismissRecoveryCodes={() => setCodes([])}
    />
  );
}
