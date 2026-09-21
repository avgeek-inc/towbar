"use client";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft02Icon,
  Key01Icon,
  SmartPhone01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@workspace/web-design-system/buttons/button";
import { toast } from "@workspace/web-design-system/overlays/toast";
import { AuthFrame } from "./auth-frame";
import { AuthForm } from "./auth-form";
import { api } from "@/lib/api";
import {
  passkeyError,
  passkeySupported,
  verifyPasskeySecondFactor,
} from "@/lib/passkeys";
import {
  type SecondFactorMethod,
  preferredSecondFactor,
  rememberedSecondFactor,
  rememberSecondFactor,
} from "@/lib/second-factor";

export function SecondFactorChallenge({
  methods,
  next,
}: {
  methods: SecondFactorMethod[];
  next: string;
}) {
  const supported = passkeySupported();
  const [method, setMethod] = useState(() =>
    preferredSecondFactor(methods, supported, rememberedSecondFactor()),
  );
  const [recovery, setRecovery] = useState(false);
  const chooseMethod = () => {
    setMethod(null);
    setRecovery(false);
  };
  const complete = useCallback(
    (verified: SecondFactorMethod) => {
      rememberSecondFactor(verified);
      window.location.replace(next);
    },
    [next],
  );

  return (
    <AuthFrame
      title="Verify your sign-in"
      description={
        method === "totp"
          ? recovery
            ? "Enter one of your unused recovery codes."
            : "Enter the six-digit code from your authenticator app."
          : method === "passkey"
            ? "Use your passkey to finish signing in."
            : "Choose how you’d like to verify your identity."
      }
    >
      <div className="grid gap-3">
        {method === "totp" ? (
          <AuthForm
            errorPresentation="toast"
            key={String(recovery)}
            fields={[
              {
                name: "code",
                label: recovery ? "Recovery code" : "Authenticator code",
                labelAction:
                  methods.length > 1 ? (
                    <Button
                      variant="ghost"
                      className="h-8 min-w-0 px-0 text-sm underline underline-offset-4"
                      onPress={chooseMethod}
                    >
                      Change method
                    </Button>
                  ) : undefined,
                required: true,
                autoComplete: "one-time-code",
                maxLength: recovery ? 100 : 6,
                inputMode: recovery ? "text" : "numeric",
                autoFocus: true,
              },
            ]}
            submitLabel="Verify"
            submitClassName="w-full"
            onSubmit={async ({ code }) => {
              await api.post(
                `/v1/public/auth/identity/two-factor/${recovery ? "verify-backup-code" : "verify-totp"}`,
                { code },
              );
              complete("totp");
            }}
          />
        ) : method === "passkey" ? (
          <PasskeyChallenge onVerified={complete} />
        ) : (
          <div className="flex flex-col gap-3">
            {methods.includes("totp") ? (
              <Button variant="secondary" onPress={() => setMethod("totp")}>
                <HugeiconsIcon
                  icon={SmartPhone01Icon}
                  className="size-4"
                  aria-hidden="true"
                />{" "}
                Use authenticator app
              </Button>
            ) : null}
            {methods.includes("passkey") ? (
              <Button
                variant="secondary"
                isDisabled={!supported}
                onPress={() => setMethod("passkey")}
              >
                <HugeiconsIcon
                  icon={Key01Icon}
                  className="size-4"
                  aria-hidden="true"
                />{" "}
                Use passkey
              </Button>
            ) : null}
            {methods.includes("passkey") && !supported ? (
              <p className="text-sm text-muted">
                Passkeys require a supported browser on HTTPS or localhost.
              </p>
            ) : null}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <a
            href="/login"
            className="inline-flex min-h-9 items-center gap-1.5 text-sm underline underline-offset-4"
          >
            <HugeiconsIcon
              icon={ArrowLeft02Icon}
              className="size-4 shrink-0"
              aria-hidden="true"
            />
            Back to sign in
          </a>
          {method === "totp" ? (
            <Button
              variant="ghost"
              className="h-9 min-w-0 px-0 text-sm underline underline-offset-4"
              onPress={() => setRecovery((value) => !value)}
            >
              {recovery ? "Use authenticator app" : "Use a recovery code"}
            </Button>
          ) : null}
          {method === "passkey" && methods.length > 1 ? (
            <Button
              variant="ghost"
              className="h-9 min-w-0 px-0 text-sm underline underline-offset-4"
              onPress={chooseMethod}
            >
              Change method
            </Button>
          ) : null}
        </div>
      </div>
    </AuthFrame>
  );
}

function PasskeyChallenge({
  onVerified,
}: {
  onVerified: (method: SecondFactorMethod) => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    // Defer until after effect cleanup so Strict Mode opens just one prompt.
    queueMicrotask(async () => {
      if (controller.signal.aborted) return;
      setBusy(true);
      try {
        await verifyPasskeySecondFactor(controller.signal);
        if (!controller.signal.aborted) onVerified("passkey");
      } catch (cause) {
        if (!controller.signal.aborted) toast.danger(passkeyError(cause));
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    });
    return () => controller.abort();
  }, [attempt, onVerified]);
  return (
    <div className="flex flex-col gap-4">
      <Button
        isDisabled={busy}
        onPress={() => setAttempt((value) => value + 1)}
      >
        <HugeiconsIcon icon={Key01Icon} className="size-4" aria-hidden="true" />
        {busy ? "Waiting for your passkey…" : "Try passkey again"}
      </Button>
    </div>
  );
}
