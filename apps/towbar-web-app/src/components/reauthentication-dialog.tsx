"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ConfirmIdentityDialog } from "@avgeek-oss/design-system";
import { api } from "@/lib/api";
import { passkeyError, verifyPasskeySecondFactor } from "@/lib/passkeys";
import { useAccess } from "./access-context";

export function ReauthenticationDialog() {
  const { user } = useAccess();
  const [open, setOpen] = useState(false);
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
  return user?.twoFactorEnabled ? (
    <ConfirmIdentityDialog
      {...shared}
      method="passkey"
      onConfirm={async () => {
        const controller = new AbortController();
        passkeyRequest.current = controller;
        try {
          await verifyPasskeySecondFactor(controller.signal);
        } catch (error) {
          throw new Error(passkeyError(error));
        }
        if (!controller.signal.aborted) finish(true);
        passkeyRequest.current = null;
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
