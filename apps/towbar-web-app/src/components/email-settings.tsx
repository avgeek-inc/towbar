"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { AuthForm, EmailChangeSettings } from "@avgeek-oss/design-system";
import { toast } from "@avgeek-oss/design-system/overlays/toast";
import { displayDate } from "@/lib/date-time-display";
import { AuthFrame } from "./auth-frame";
import { useAccess } from "./access-context";
import { useApiQuery } from "@/hooks/use-api-query";
import { api } from "@/lib/api";

export function EmailSettings() {
  const { user } = useAccess();
  const [resendAt, setResendAt] = useState(0);
  const query = useApiQuery<{
    pending: { email: string; expiresAt: string } | null;
  }>("/v1/core/profile/email-change");
  if (!user) return null;
  return (
    <EmailChangeSettings
      email={user.email}
      isVerified={user.emailVerified}
      pendingChange={query.data?.pending}
      error={query.error}
      formatDate={displayDate}
      resendAvailableAt={resendAt}
      onRequestChange={async (email) => {
        await api.post("/v1/core/profile/email-change", { email });
        query.refresh();
        toast.success("Confirmation email queued");
      }}
      onCancelChange={async () => {
        await api.delete("/v1/core/profile/email-change");
        query.refresh();
        toast.success("Email change cancelled");
      }}
      onResendVerification={async () => {
        await api.post("/v1/public/auth/identity/send-verification-email", {
          email: user.email,
          callbackURL: `${window.location.origin}/settings/email-password`,
        });
        setResendAt(Date.now() + 60_000);
        toast.success("Confirmation email queued");
      }}
    />
  );
}
export function ConfirmEmailChange() {
  const [proof, setProof] = useState<{ id: string; token: string } | null>(
    null,
  );
  const [done, setDone] = useState(false);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    function readProof() {
      const hash = window.location.hash.slice(1);
      const match = hash.match(/^([a-f0-9-]{36})\.([A-Za-z0-9_-]{43})$/);
      if (match) {
        setProof({ id: match[1]!, token: match[2]! });
        setDone(false);
        window.history.replaceState(null, "", window.location.pathname);
      } else if (hash) setProof(null);
      setChecked(true);
    }
    readProof();
    window.addEventListener("hashchange", readProof);
    return () => window.removeEventListener("hashchange", readProof);
  }, []);
  return (
    <AuthFrame
      title={done ? "Email updated" : "Confirm email change"}
      description={
        done
          ? "Use your new email address to sign in. Your password is unchanged."
          : "Confirm the new email address for your Towbar account."
      }
    >
      {!checked ? (
        <p role="status">Checking confirmation link…</p>
      ) : done ? (
        <Link className="underline underline-offset-4" href="/login">
          Sign in
        </Link>
      ) : proof ? (
        <AuthForm
          fields={[]}
          submitLabel="Confirm email change"
          onSubmit={async () => {
            await api.post("/v1/public/auth/confirm-email-change", proof);
            setDone(true);
            window.dispatchEvent(new Event("towbar:identity-changed"));
          }}
        >
          <p className="text-sm text-muted">
            You’ll be signed out of all browser sessions after confirming.
          </p>
        </AuthForm>
      ) : (
        <p role="alert">
          Open the full confirmation link from your email. If it has expired,
          request a new link from Email &amp; Password in Personal Settings.
        </p>
      )}
    </AuthFrame>
  );
}
