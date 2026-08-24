"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useId, useState, type FormEvent } from "react";

import { IdentityCredentialsForm } from "@workspace/identity-web-ui/identity-credentials-form";
import { Button } from "@workspace/web-design-system/buttons/button";
import { Alert } from "@workspace/web-design-system/feedback/alert";
import { Skeleton } from "@workspace/web-design-system/feedback/skeleton";
import {
  Field,
  FieldError,
  FieldGroup,
} from "@workspace/web-design-system/forms/field";
import { Input } from "@workspace/web-design-system/forms/input";
import { Label } from "@workspace/web-design-system/forms/label";
import { PasswordInput } from "@workspace/web-design-system/forms/password-input";

import { AuthFrame } from "@/components/auth-frame";
import { api } from "@/lib/api";
import { safeNextPath } from "@/lib/safe-next-path";

export function LoginForm() {
  const params = useSearchParams();
  const next = safeNextPath(params.get("next"));
  const [setupRequired, setSetupRequired] = useState<boolean>();
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
  if (setupRequired) return <InitialOwnerSetup />;

  return (
    <AuthFrame description="Use your Towbar owner account." title="Sign in">
      <IdentityCredentialsForm
        identifierLabel="Email"
        identifierType="email"
        onSubmit={async ({ identifier, password }) => {
          await api.post("/v1/public/auth/login-email", {
            email: identifier,
            password,
          });
          window.location.replace(next);
        }}
      />
    </AuthFrame>
  );
}

function InitialOwnerSetup() {
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
    const displayName = String(data.get("displayName") ?? "").trim();
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");
    const confirmPassword = String(data.get("confirmPassword") ?? "");
    const nextErrors: Record<string, string> = {};
    if (!displayName) nextErrors.displayName = "Name is required";
    if (!/^\S+@\S+\.\S+$/u.test(email)) {
      nextErrors.email = "Enter a valid email address";
    }
    if (password.length < 12) {
      nextErrors.password = "Use at least 12 characters";
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
      description="Create the first owner account. Setup locks after this step."
      title="Set up Towbar"
    >
      <form className="grid gap-5" method="post" onSubmit={submit}>
        <FieldGroup>
          <Field>
            <Label htmlFor={nameId}>Name</Label>
            <Input
              aria-invalid={Boolean(errors.displayName)}
              autoComplete="name"
              id={nameId}
              name="displayName"
              type="text"
            />
            {errors.displayName ? (
              <FieldError>{errors.displayName}</FieldError>
            ) : null}
          </Field>
          <Field>
            <Label htmlFor={emailId}>Email</Label>
            <Input
              aria-invalid={Boolean(errors.email)}
              autoComplete="email"
              id={emailId}
              name="email"
              type="email"
            />
            {errors.email ? <FieldError>{errors.email}</FieldError> : null}
          </Field>
          <Field>
            <Label htmlFor={passwordId}>Password</Label>
            <PasswordInput
              aria-invalid={Boolean(errors.password)}
              autoComplete="new-password"
              id={passwordId}
              name="password"
            />
            {errors.password ? (
              <FieldError>{errors.password}</FieldError>
            ) : null}
          </Field>
          <Field>
            <Label htmlFor={confirmPasswordId}>Confirm password</Label>
            <PasswordInput
              aria-invalid={Boolean(errors.confirmPassword)}
              autoComplete="new-password"
              id={confirmPasswordId}
              name="confirmPassword"
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
          {isSubmitting ? "Creating owner…" : "Create owner"}
        </Button>
      </form>
      <p className="text-muted typography--body-sm">
        Complete this step before exposing Towbar through a public proxy.
      </p>
    </AuthFrame>
  );
}
