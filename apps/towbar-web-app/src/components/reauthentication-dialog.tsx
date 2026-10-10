"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ConfirmIdentityDialog } from "@avgeek-oss/design-system";
import { api } from "@/lib/api";
import { passkeyError, verifyPasskeySecondFactor } from "@/lib/passkeys";
import { useAccess } from "./access-context";

export function ReauthenticationDialog({
  twoFactorEnabled,
}: { twoFactorEnabled?: boolean } = {}) {
  const { user } = useAccess();
  const [open, setOpen] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const pending = useRef<Array<(result: boolean) => void>>([]);
  const passkeyRequest = useRef<AbortController | null>(null);
  const finish = useCallback((result: boolean) => {
    pending.current.splice(0).forEach((resolve) => resolve(result));
    setOpen(false);
  }, []);
  useEffect(() => {
    const queue = pending.current;
    const handle = (event: Event) => {
      const request = event as CustomEvent<{
        resolve: (result: boolean) => void;
      }>;
      queue.push(request.detail.resolve);
      setOpen(true);
    };
    window.addEventListener("towbar:reauthenticate", handle);
    return () => {
      window.removeEventListener("towbar:reauthenticate", handle);
      passkeyRequest.current?.abort();
      queue.splice(0).forEach((resolve) => resolve(false));
    };
  }, []);
  const shared = {
    isOpen: open,
    onOpenChange: (value: boolean) => {
      if (!value) finish(false);
    },
  };
  return (twoFactorEnabled ?? user?.twoFactorEnabled) ? (
    <ConfirmIdentityDialog
      {...shared}
      method="passkey"
      onCancelRequest={
        verifying ? undefined : () => passkeyRequest.current?.abort()
      }
      onConfirm={async () => {
        const controller = new AbortController();
        passkeyRequest.current = controller;
        setVerifying(false);
        try {
          await verifyPasskeySecondFactor(controller.signal, () =>
            setVerifying(true),
          );
        } catch (error) {
          if (!controller.signal.aborted) throw new Error(passkeyError(error));
        } finally {
          if (passkeyRequest.current === controller) {
            passkeyRequest.current = null;
            setVerifying(false);
          }
        }
        if (!controller.signal.aborted) finish(true);
      }}
    />
  ) : (
    <ConfirmIdentityDialog
      {...shared}
      onConfirm={async ({ password }) => {
        await api.post("/v1/core/session/reauthenticate", { password });
        finish(true);
      }}
    />
  );
}
