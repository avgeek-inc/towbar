"use client";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@workspace/web-design-system/buttons/button";
import { toast } from "@workspace/web-design-system/overlays/toast";
import { AuthFrame, authTextActionClassName } from "./auth-frame";
import { AuthForm } from "./auth-form";
import { api } from "@/lib/api";
import { passkeyError, verifyPasskeySecondFactor } from "@/lib/passkeys";

export function SecondFactorChallenge({ next }: { next: string }) {
  const [recovery, setRecovery] = useState(false);
  const complete = useCallback(() => window.location.replace(next), [next]);
  return (
    <AuthFrame title="Verify your sign-in" description="">
      {recovery ? (
        <AuthForm
          errorPresentation="toast"
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
          submitClassName="w-full"
          onSubmit={async ({ code }) => {
            await api.post(
              "/v1/public/auth/identity/passkey/verify-recovery-code",
              { code },
            );
            complete();
          }}
        />
      ) : (
        <PasskeyChallenge onVerified={complete} />
      )}
      <Button variant="ghost" onPress={() => setRecovery((value) => !value)}>
        {recovery ? "Use passkey" : "Use a recovery code"}
      </Button>
      <a href="/login" className={authTextActionClassName}>
        Back to sign in
      </a>
    </AuthFrame>
  );
}
export function PasskeyChallenge({ onVerified }: { onVerified: () => void }) {
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
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
    <Button isDisabled={busy} onPress={() => setAttempt((value) => value + 1)}>
      {busy ? "Waiting for your passkey…" : "Try passkey again"}
    </Button>
  );
}
