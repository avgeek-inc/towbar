"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AuthForm, PasskeyVerification } from "@avgeek-oss/design-system";
import { Button } from "@avgeek-oss/design-system/buttons/button";
import { toast } from "@avgeek-oss/design-system/overlays/toast";
import { AuthFrame, AuthBrand, authTextActionClassName } from "./auth-frame";
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
  // The password was verified before the challenge cookie was issued. Only the
  // recovery code is needed for this endpoint; do not collect credentials again.
  return (
    <AuthFrame
      title="Use a recovery code"
      description="Enter an unused recovery code to finish signing in."
    >
      <AuthForm
        fields={[
          {
            name: "code",
            label: "Recovery code",
            required: true,
            autoComplete: "off",
            maxLength: 100,
          },
        ]}
        submitLabel="Sign in"
        onSubmit={async ({ code }) => {
          await api.post(
            "/v1/public/auth/identity/passkey/verify-recovery-code",
            { code },
          );
          complete();
        }}
      />
      <Button variant="ghost" onPress={() => setRecovery(false)}>
        Use passkey
      </Button>
      <a href="/login" className={authTextActionClassName}>
        ← Back to Sign In
      </a>
    </AuthFrame>
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
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    queueMicrotask(async () => {
      if (controller.signal.aborted) return;
      setBusy(true);
      try {
        await verifyPasskeySecondFactor(controller.signal);
        if (!controller.signal.aborted) onVerified();
      } catch (cause) {
        if (!controller.signal.aborted) toast.danger(passkeyError(cause));
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    });
    return () => controller.abort();
  }, [attempt, onVerified]);
  return (
    <PasskeyVerification
      brand={<AuthBrand />}
      isPending={busy}
      onRetry={() => setAttempt((value) => value + 1)}
      onCancelRequest={() => {
        request.current?.abort();
        setBusy(false);
      }}
      onRecoverySignIn={onRecovery}
      onBackToSignIn={() => window.location.assign("/login")}
    />
  );
}
