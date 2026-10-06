"use client";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  TeamSetup,
  IdentityCredentialsForm,
  Button,
} from "@avgeek-oss/design-system";
import { HugeiconsIcon } from "@hugeicons/react";
import { Login01Icon } from "@hugeicons/core-free-icons";
import Link from "next/link";
import { Alert } from "@avgeek-oss/design-system/feedback/alert";
import { QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { SecondFactorChallenge } from "./second-factor-challenge";
import type { DateTimePreferenceOptions } from "@avgeek-oss/design-system/patterns/settings/date-time-preference-fields";
import { passkeyError, verifyPasskeySecondFactor } from "@/lib/passkeys";
import { toast } from "@avgeek-oss/design-system/overlays/toast";
import {
  AuthFrame,
  AuthBrand,
  authTextActionClassName,
} from "@/components/auth-frame";
import { api } from "@/lib/api";
import { safeNextPath } from "@/lib/safe-next-path";

type SetupStatus =
  | { setupRequired: false }
  | { setupRequired: true; options: DateTimePreferenceOptions };

export function LoginForm() {
  const params = useSearchParams();
  const next = safeNextPath(params.get("next"));
  const [setup, setSetup] = useState<SetupStatus>();
  const [twoFactor, setTwoFactor] = useState(false);
  const passkeyPending = useRef(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const passkeyController = useRef<AbortController | null>(null);
  useEffect(() => () => passkeyController.current?.abort(), []);
  const [statusError, setStatusError] = useState<string>();

  useEffect(() => {
    let active = true;
    api
      .get<SetupStatus>("/v1/public/auth/setup-status")
      .then((result) => active && setSetup(result))
      .catch((error: unknown) => {
        if (!active) return;
        setStatusError(
          error instanceof Error
            ? error.message
            : "Unable to load Towbar setup",
        );
      });
    return () => {
      active = false;
    };
  }, []);

  if (statusError) {
    return (
      <AuthFrame
        description="Towbar setup could not be loaded."
        title="Sign in"
      >
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>{statusError}</Alert.Description>
          </Alert.Content>
        </Alert>
      </AuthFrame>
    );
  }
  if (setup === undefined) {
    return <QueryLoading />;
  }
  if (setup.setupRequired) return <InitialTeamSetup options={setup.options} />;

  if (twoFactor) return <SecondFactorChallenge next={next} />;
  return (
    <AuthFrame
      title="Sign in"
      description="Sign in to your team’s Towbar instance."
    >
      <IdentityCredentialsForm
        identifierLabel="Email"
        identifierType="email"
        identifierAutoComplete="email"
        disabled={passkeyBusy}
        submitIcon={<HugeiconsIcon aria-hidden icon={Login01Icon} size={16} />}
        passwordAction={
          <Link href="/forgot-password" className={authTextActionClassName}>
            Forgot password?
          </Link>
        }
        onSubmit={async ({ identifier, password }) => {
          const result = await api.post<{
            twoFactorRequired: boolean;
            twoFactorMethods: string[];
          }>("/v1/public/auth/login-email", {
            email: identifier,
            password,
          });
          if (result.twoFactorRequired) {
            if (!result.twoFactorMethods?.length)
              throw new Error(
                "Your verification methods could not be loaded. Sign in again.",
              );
            setTwoFactor(true);
            return;
          }
          window.location.replace(next);
        }}
      />
      <Button
        className="w-full"
        variant="secondary"
        isDisabled={passkeyBusy}
        onPress={async () => {
          if (passkeyPending.current) return;
          passkeyPending.current = true;
          setPasskeyBusy(true);
          const controller = new AbortController();
          passkeyController.current = controller;
          try {
            await verifyPasskeySecondFactor(controller.signal);
            window.location.replace(next);
          } catch (error) {
            if (!controller.signal.aborted) toast.danger(passkeyError(error));
          } finally {
            passkeyPending.current = false;
            passkeyController.current = null;
            setPasskeyBusy(false);
          }
        }}
      >
        {passkeyBusy ? "Waiting for your passkey…" : "Sign in with Passkey"}
      </Button>
    </AuthFrame>
  );
}

function InitialTeamSetup({ options }: { options: DateTimePreferenceOptions }) {
  return (
    <TeamSetup
      brand={<AuthBrand />}
      preferenceOptions={options}
      onSubmit={async ({
        team,
        name,
        email,
        password,
        ...dateTimePreferences
      }) => {
        if (!team.trim() || !name.trim())
          throw new Error("Team name and your name are required");
        await api.post("/v1/public/auth/setup", {
          teamName: team.trim(),
          displayName: name.trim(),
          email: email.trim(),
          password,
          confirmPassword: password,
          dateTimePreferences,
        });
        window.location.replace("/");
      }}
    />
  );
}
