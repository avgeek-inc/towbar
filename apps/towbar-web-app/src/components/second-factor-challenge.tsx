"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  PasskeyRecoveryVerification,
  PasskeyVerification,
} from "@avgeek-oss/design-system";
import { toast } from "@avgeek-oss/design-system/overlays/toast";
import { AuthBrand } from "./auth-frame";
import { api } from "@/lib/api";
import { passkeyError, verifyPasskeySecondFactor } from "@/lib/passkeys";

export function SecondFactorChallenge({ next }: { next: string }) {
  const [recovery, setRecovery] = useState(false);
  const complete = useCallback(() => window.location.replace(next), [next]);
  if (!recovery)
    return (
      <PasskeyChallenge
        onVerified={complete}
        onRecovery={() => setRecovery(true)}
      />
    );
  return (
    <PasskeyRecoveryVerification
      brand={<AuthBrand />}
      onSubmit={async ({ code }) => {
        await api.post(
          "/v1/public/auth/identity/passkey/verify-recovery-code",
          { code },
        );
        complete();
      }}
      onPasskeyVerification={() => setRecovery(false)}
      onBackToSignIn={() => window.location.assign("/login")}
    />
  );
}
function PasskeyChallenge({
  onVerified,
  onRecovery,
}: {
  onVerified: () => void;
  onRecovery: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    queueMicrotask(async () => {
      if (controller.signal.aborted) return;
      setBusy(true);
      setVerifying(false);
      try {
        await verifyPasskeySecondFactor(controller.signal, () =>
          setVerifying(true),
        );
        if (!controller.signal.aborted) onVerified();
      } catch (cause) {
        if (!controller.signal.aborted) toast.danger(passkeyError(cause));
      } finally {
        if (!controller.signal.aborted) {
          setBusy(false);
          setVerifying(false);
        }
      }
    });
    return () => controller.abort();
  }, [attempt, onVerified]);
  return (
    <PasskeyVerification
      brand={<AuthBrand />}
      isPending={busy}
      onRetry={() => setAttempt((value) => value + 1)}
      onCancelRequest={
        verifying
          ? undefined
          : () => {
              request.current?.abort();
              setBusy(false);
            }
      }
      onRecoverySignIn={onRecovery}
      onBackToSignIn={() => window.location.assign("/login")}
    />
  );
}
