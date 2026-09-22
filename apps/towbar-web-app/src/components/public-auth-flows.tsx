"use client";
import Link from "next/link";
import { ArrowLeft02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import type { TowbarUser } from "@workspace/towbar-web-client";
import {
  roleDescriptions,
  roleLabels,
  type WorkspaceRole,
} from "@workspace/towbar-access";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { AuthFrame, authTextActionClassName } from "./auth-frame";
import { AuthForm } from "./auth-form";
import { api } from "@/lib/api";
import { useApiQuery } from "@/hooks/use-api-query";

const newPasswordFields = [
  {
    name: "newPassword",
    label: "Password",
    type: "password",
    autoComplete: "new-password",
    required: true,
    minLength: 15,
    maxLength: 1024,
    description:
      "Use at least 15 characters. A long, unique passphrase works well.",
  },
  {
    name: "confirmPassword",
    label: "Confirm password",
    type: "password",
    autoComplete: "new-password",
    required: true,
    minLength: 15,
    maxLength: 1024,
  },
];
function requireMatching(values: Record<string, string>) {
  if (values.newPassword !== values.confirmPassword)
    throw new Error("Passwords do not match");
}
export function FirstPasswordForm() {
  const session = useApiQuery<{ user: TowbarUser | null }>(
    "/v1/public/auth/state",
  );
  if (session.error) return <QueryError message={session.error} />;
  if (!session.data) return <QueryLoading />;
  const user = session.data.user;
  if (!user)
    return (
      <AuthFrame
        title="Sign in to continue"
        description="Sign in with your temporary password, or open your invitation."
      >
        <Link href="/login" className={authTextActionClassName}>
          Sign in
        </Link>
      </AuthFrame>
    );
  return (
    <AuthFrame
      title={
        user.passwordSetupRequired
          ? "Choose your password"
          : "Replace your temporary password"
      }
      description="Secure your account before opening the workspace."
    >
      <AuthForm
        fields={[
          ...(!user.passwordSetupRequired
            ? [
                {
                  name: "currentPassword",
                  label: "Temporary password",
                  type: "password",
                  autoComplete: "current-password",
                  required: true,
                },
              ]
            : []),
          ...newPasswordFields,
        ]}
        submitLabel="Set password"
        onSubmit={async (values) => {
          requireMatching(values);
          await api.put("/v1/core/profile/password", values);
          window.location.replace("/");
        }}
      />
      <AuthAction
        label="Sign out"
        onAction={async () => {
          await api.delete("/v1/core/session");
          window.location.replace("/login");
        }}
      />
    </AuthFrame>
  );
}
export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  return (
    <AuthFrame
      title="Reset your password"
      description={
        sent
          ? "If an account exists for that email, we’ll send a password reset link. Check your inbox and spam folder."
          : "Enter your email to request a password reset link."
      }
    >
      {!sent ? (
        <AuthForm
          errorPresentation="toast"
          fields={[
            {
              name: "email",
              label: "Email",
              type: "email",
              autoComplete: "email",
              required: true,
              maxLength: 320,
            },
          ]}
          submitLabel="Send reset link"
          onSubmit={async (values) => {
            await api.post("/v1/public/auth/identity/request-password-reset", {
              email: values.email,
              redirectTo: `${window.location.origin}/reset-password`,
            });
            setSent(true);
          }}
        />
      ) : null}
      <BackToSignIn />
    </AuthFrame>
  );
}
export function ResetPasswordForm() {
  const params = useSearchParams();
  const token = params.get("token");
  const [complete, setComplete] = useState(false);
  return (
    <AuthFrame
      title={complete ? "Password updated" : "Choose a new password"}
      description={
        complete
          ? "Your previous sessions have been signed out."
          : token
            ? "This reset link can be used once."
            : "This link is missing or has expired. Request a new password reset."
      }
    >
      {token && !complete ? (
        <AuthForm
          errorPresentation="toast"
          fields={newPasswordFields}
          submitLabel="Reset password"
          onSubmit={async (values) => {
            requireMatching(values);
            await api.post("/v1/public/auth/identity/reset-password", {
              token,
              newPassword: values.newPassword,
            });
            window.history.replaceState(null, "", "/reset-password");
            setComplete(true);
          }}
        />
      ) : null}
      {!complete ? (
        <Link href="/forgot-password" className={authTextActionClassName}>
          Request a new link
        </Link>
      ) : null}
      <BackToSignIn />
    </AuthFrame>
  );
}
function BackToSignIn() {
  return (
    <Link
      href="/login"
      className={`inline-flex w-fit items-center gap-1.5 ${authTextActionClassName}`}
    >
      <HugeiconsIcon
        icon={ArrowLeft02Icon}
        className="size-4 shrink-0"
        aria-hidden="true"
      />
      Back to Sign In
    </Link>
  );
}
export function InvitationForm({ invitationId }: { invitationId: string }) {
  const query = useApiQuery<{
    invitation: {
      email: string;
      teamName: string;
      role: WorkspaceRole;
      expiresAt: string;
    };
  }>(`/v1/public/auth/invitations/${invitationId}`);
  const session = useApiQuery<{
    user: TowbarUser | null;
    account: { email: string; emailVerified: boolean } | null;
  }>("/v1/public/auth/state");
  const [verifying, setVerifying] = useState(false);
  const [existing, setExisting] = useState(false);
  const [sent, setSent] = useState(false);
  const self = `/invite/${invitationId}`;
  if (query.error)
    return (
      <AuthFrame
        title="Invitation unavailable"
        description="This invitation may have expired, been revoked, or already been accepted. Ask your admin for a new link."
      >
        <Link href="/login" className={authTextActionClassName}>
          Sign in
        </Link>
      </AuthFrame>
    );
  if (!query.data || !session.data) return <QueryLoading />;
  const invitation = query.data.invitation;
  const account = session.data.account;
  return (
    <AuthFrame
      title={`Join ${invitation.teamName}`}
      description={`Invited as ${roleLabels[invitation.role]}. ${roleDescriptions[invitation.role]}`}
    >
      <p className="break-words text-sm">{invitation.email}</p>
      {account && account.email !== invitation.email ? (
        <>
          <p>Sign out and use the email address on this invitation.</p>
          <AuthAction
            label="Sign out"
            onAction={async () => {
              await api.post("/v1/public/auth/identity/sign-out", {});
              window.location.reload();
            }}
          />
        </>
      ) : account?.emailVerified ? (
        <AuthAction
          label="Join team"
          onAction={async () => {
            await api.post(
              `/v1/public/auth/invitations/${invitationId}/accept`,
              {},
            );
            window.location.replace("/");
          }}
        />
      ) : account ? (
        <>
          <p>
            {sent
              ? "Check your inbox for a verification link, then return to this page."
              : "Verify your email address before joining."}
          </p>
          <AuthAction
            label={
              sent ? "Resend verification email" : "Send verification email"
            }
            onAction={async () => {
              await api.post(
                "/v1/public/auth/identity/send-verification-email",
                {
                  email: account.email,
                  callbackURL: `${window.location.origin}${self}`,
                },
              );
              setSent(true);
            }}
          />
        </>
      ) : verifying ? (
        <AuthForm
          fields={[
            {
              name: "name",
              label: "Name",
              autoComplete: "name",
              required: true,
              maxLength: 120,
            },
            {
              name: "code",
              label: "Email verification code",
              autoComplete: "one-time-code",
              required: true,
              maxLength: 6,
              description:
                "Enter the six-digit code sent to your invited email address.",
            },
          ]}
          submitLabel="Verify and continue"
          onSubmit={async (values) => {
            await api.post(
              `/v1/public/auth/invitations/${invitationId}/signup`,
              values,
            );
            window.location.replace("/first-password");
          }}
        />
      ) : existing ? (
        <p>
          An account already exists for this email. Sign in to accept your
          invitation.
        </p>
      ) : (
        <AuthAction
          label="Verify email to join"
          onAction={async () => {
            const result = await api.post<{ existingAccount: boolean }>(
              `/v1/public/auth/invitations/${invitationId}/verify`,
              {},
            );
            setExisting(result.existingAccount);
            setVerifying(!result.existingAccount);
          }}
        />
      )}
      {!account ? (
        <Link
          href={`/login?next=${encodeURIComponent(self)}`}
          className={authTextActionClassName}
        >
          Already have an account? Sign in
        </Link>
      ) : null}
    </AuthFrame>
  );
}

function AuthAction({
  label,
  onAction,
}: {
  label: string;
  onAction: () => Promise<void>;
}) {
  return <AuthForm fields={[]} onSubmit={onAction} submitLabel={label} />;
}
