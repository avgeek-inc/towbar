"use client";
import { HugeiconsIcon } from "@hugeicons/react";
import { Login01Icon, UserAdd01Icon } from "@hugeicons/core-free-icons";

import { useSearchParams } from "next/navigation";
import { useEffect, useId, useState, type FormEvent } from "react";

import { IdentityCredentialsForm } from "@workspace/identity-web-ui/identity-credentials-form";
import { Button } from "@workspace/web-design-system/buttons/button";
import { Alert } from "@workspace/web-design-system/feedback/alert";
import { Skeleton } from "@workspace/web-design-system/feedback/skeleton";
import {
  FieldDescription,
  Field,
  FieldError,
  FieldGroup,
} from "@workspace/web-design-system/forms/field";
import { Input } from "@workspace/web-design-system/forms/input";
import { Label } from "@workspace/web-design-system/forms/label";
import { PasswordInput } from "@workspace/web-design-system/forms/password-input";

import Link from "next/link";
import { SecondFactorChallenge } from "./second-factor-challenge";
import type { SecondFactorMethod } from "@/lib/second-factor";
import { AuthFrame } from "@/components/auth-frame";
import { api } from "@/lib/api";
import { safeNextPath } from "@/lib/safe-next-path";

export function LoginForm() {
  const params = useSearchParams();
  const next = safeNextPath(params.get("next"));
  const [setupRequired, setSetupRequired] = useState<boolean>();
  const [twoFactor, setTwoFactor] = useState<SecondFactorMethod[] | null>(null);
  const [statusError, setStatusError] = useState<string>();

  useEffect(() => {
    let active = true;
    api
      .get<{ setupRequired: boolean }>("/v1/public/auth/setup-status")
      .then((result) => active && setSetupRequired(result.setupRequired))
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
  if (setupRequired === undefined) {
    return (
      <Skeleton
        aria-label="Loading Towbar"
        className="h-72 w-full rounded-2xl"
      />
    );
  }
  if (setupRequired) return <InitialTeamSetup />;

  if (twoFactor)
    return <SecondFactorChallenge methods={twoFactor} next={next} />;
  return (
    <AuthFrame
      description="Sign in to your team’s Towbar instance."
      title="Sign in"
    >
      <IdentityCredentialsForm
        errorPresentation="toast"
        submitIcon={
          <HugeiconsIcon
            aria-hidden="true"
            icon={Login01Icon}
            className="size-4 shrink-0"
          />
        }
        identifierLabel="Email"
        identifierType="email"
        passwordAction={
          <Link
            className="text-sm underline underline-offset-4"
            href="/forgot-password"
          >
            Forgot password?
          </Link>
        }
        onSubmit={async ({ identifier, password }) => {
          const result = await api.post<{
            twoFactorRequired: boolean;
            twoFactorMethods: SecondFactorMethod[];
          }>("/v1/public/auth/login-email", {
            email: identifier,
            password,
          });
          if (result.twoFactorRequired) {
            if (!result.twoFactorMethods?.length)
              throw new Error(
                "Your verification methods could not be loaded. Sign in again.",
              );
            setTwoFactor(result.twoFactorMethods);
            return;
          }
          window.location.replace(next);
        }}
      />
    </AuthFrame>
  );
}

function InitialTeamSetup() {
  const teamId = useId();
  const codeId = useId();
  const [setupCode, setSetupCode] = useState("");
  useEffect(() => {
    const code = new URLSearchParams(window.location.hash.slice(1)).get("code");
    if (code) {
      setSetupCode(code);
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);
  const nameId = useId();
  const emailId = useId();
  const passwordId = useId();
  const confirmPasswordId = useId();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submissionError, setSubmissionError] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    const data = new FormData(event.currentTarget);
    const teamName = String(data.get("teamName") ?? "").trim();
    const displayName = String(data.get("displayName") ?? "").trim();
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");
    const confirmPassword = String(data.get("confirmPassword") ?? "");
    const nextErrors: Record<string, string> = {};
    if (!teamName) nextErrors.teamName = "Team name is required";
    if (!setupCode)
      nextErrors.setupCode = "Enter the setup code from your installer";
    if (!displayName) nextErrors.displayName = "Name is required";
    if (!/^\S+@\S+\.\S+$/u.test(email)) {
      nextErrors.email = "Enter a valid email address";
    }
    if (password.length < 15) {
      nextErrors.password = "Use at least 15 characters";
    }
    if (confirmPassword !== password) {
      nextErrors.confirmPassword = "Passwords do not match";
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmissionError(undefined);
    setIsSubmitting(true);
    try {
      await api.post("/v1/public/auth/setup", {
        confirmPassword,
        teamName,
        setupCode,
        displayName,
        email,
        password,
      });
      window.location.replace("/");
    } catch (error) {
      setSubmissionError(
        error instanceof Error ? error.message : "Unable to set up Towbar",
      );
      setIsSubmitting(false);
    }
  }

  return (
    <AuthFrame
      description="Create your team and its first Admin account."
      title="Set up Towbar"
    >
      <form className="content-grid" method="post" onSubmit={submit}>
        <FieldGroup>
          <Field>
            <Label htmlFor={teamId} isRequired>
              Team name
            </Label>
            <Input
              id={teamId}
              name="teamName"
              autoComplete="organization"
              maxLength={120}
              required
            />
            {errors.teamName ? (
              <FieldError>{errors.teamName}</FieldError>
            ) : null}
          </Field>
          <Field>
            <Label htmlFor={codeId} isRequired>
              Setup code
            </Label>
            <PasswordInput
              id={codeId}
              name="setupCode"
              value={setupCode}
              onChange={(event) => setSetupCode(event.target.value)}
              autoComplete="off"
              required
            />
            {errors.setupCode ? (
              <FieldError>{errors.setupCode}</FieldError>
            ) : null}
          </Field>
          <Field>
            <Label htmlFor={nameId} isRequired>
              Name
            </Label>
            <Input
              aria-invalid={Boolean(errors.displayName)}
              autoComplete="name"
              id={nameId}
              name="displayName"
              required
              type="text"
            />
            {errors.displayName ? (
              <FieldError>{errors.displayName}</FieldError>
            ) : null}
          </Field>
          <Field>
            <Label htmlFor={emailId} isRequired>
              Email
            </Label>
            <Input
              aria-invalid={Boolean(errors.email)}
              autoComplete="email"
              id={emailId}
              name="email"
              required
              type="email"
            />
            {errors.email ? <FieldError>{errors.email}</FieldError> : null}
          </Field>
          <Field>
            <Label htmlFor={passwordId} isRequired>
              Password
            </Label>
            <PasswordInput
              aria-invalid={Boolean(errors.password)}
              autoComplete="new-password"
              id={passwordId}
              name="password"
              required
            />
            {errors.password ? (
              <FieldError>{errors.password}</FieldError>
            ) : null}
          </Field>
          <Field>
            <Label htmlFor={confirmPasswordId} isRequired>
              Confirm password
            </Label>
            <PasswordInput
              aria-invalid={Boolean(errors.confirmPassword)}
              autoComplete="new-password"
              id={confirmPasswordId}
              name="confirmPassword"
              required
            />
            {errors.confirmPassword ? (
              <FieldError>{errors.confirmPassword}</FieldError>
            ) : null}
          </Field>
        </FieldGroup>
        {submissionError ? (
          <Alert status="danger">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Description>{submissionError}</Alert.Description>
            </Alert.Content>
          </Alert>
        ) : null}
        <Button className="w-full" isDisabled={isSubmitting} type="submit">
          <HugeiconsIcon
            aria-hidden="true"
            icon={UserAdd01Icon}
            className="size-4 shrink-0"
          />
          {isSubmitting ? "Creating team…" : "Create team"}
        </Button>
      </form>
      <FieldDescription>
        Use the single-use setup code from the installer. Your password must
        contain at least 15 characters.
      </FieldDescription>
    </AuthFrame>
  );
}
