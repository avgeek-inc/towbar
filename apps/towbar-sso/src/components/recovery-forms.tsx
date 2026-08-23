"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert } from "@workspace/web-design-system/feedback/alert";
import { Button } from "@workspace/web-design-system/buttons/button";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@workspace/web-design-system/forms/field";
import { PasswordInput } from "@workspace/web-design-system/forms/password-input";
import { AuthFrame } from "@/components/auth-frame";
import { api } from "@/lib/api";

export function ForgotPasswordForm() {
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <AuthFrame
      description="Recovery is operator-controlled while Towbar remains private."
      title="Recover access"
    >
      {accepted ? (
        <Alert>
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Request noted</Alert.Title>
            <Alert.Description>
              Ask the workspace operator to issue a one-time recovery token from
              the Towbar API host.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : (
        <form
          className="grid gap-5"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError(undefined);
            try {
              await api.post("/v1/public/auth/forgot-password", {});
              setAccepted(true);
            } catch (caught) {
              setError(
                caught instanceof Error
                  ? caught.message
                  : "Could not show recovery instructions",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          {error ? (
            <Alert status="danger">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>Request failed</Alert.Title>
                <Alert.Description>{error}</Alert.Description>
              </Alert.Content>
            </Alert>
          ) : null}
          <p className="text-muted typography--body-sm">
            Towbar does not reveal whether an account exists and does not send
            recovery email yet.
          </p>
          <Button isDisabled={busy} type="submit">
            {busy ? "Loading…" : "Show recovery instructions"}
          </Button>
        </form>
      )}
      <Link
        className="typography--body-sm underline-offset-4 pointer-fine:hover:underline"
        href="/"
      >
        Back to sign in
      </Link>
    </AuthFrame>
  );
}

export function ResetPasswordForm() {
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    const newPassword = String(
      new FormData(event.currentTarget).get("newPassword") ?? "",
    );
    const confirmPassword = String(
      new FormData(event.currentTarget).get("confirmPassword") ?? "",
    );
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match");
      return;
    }
    setBusy(true);
    try {
      await api.post("/v1/public/auth/reset-password", {
        confirmPassword,
        newPassword,
        token: params.get("token") ?? "",
      });
      setDone(true);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not reset password",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthFrame
      description="A recovery token can be used once and revokes existing sessions."
      title="Set a new password"
    >
      {done ? (
        <Alert>
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Password changed</Alert.Title>
            <Alert.Description>
              <Link href="/">Sign in with the new password.</Link>
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : (
        <form className="grid gap-5" onSubmit={submit}>
          {error ? (
            <Alert status="danger">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>Reset failed</Alert.Title>
                <Alert.Description>{error}</Alert.Description>
              </Alert.Content>
            </Alert>
          ) : null}
          <Field>
            <FieldLabel>New password</FieldLabel>
            <PasswordInput
              autoComplete="new-password"
              maxLength={1_024}
              minLength={12}
              name="newPassword"
              required
            />
            <FieldDescription>Use at least 12 characters.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel>Confirm new password</FieldLabel>
            <PasswordInput
              autoComplete="new-password"
              maxLength={1_024}
              minLength={12}
              name="confirmPassword"
              required
            />
          </Field>
          <Button isDisabled={busy} type="submit">
            {busy ? "Resetting…" : "Reset password"}
          </Button>
        </form>
      )}
    </AuthFrame>
  );
}
