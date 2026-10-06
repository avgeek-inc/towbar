"use client";
import Link from "next/link";
import { ArrowLeft02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import type { TowbarUser } from "@workspace/towbar-web-client";
import {
  roleDescriptions,
  roleLabels,
  type WorkspaceRole,
} from "@workspace/towbar-access";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { AuthFrame, AuthBrand, authTextActionClassName } from "./auth-frame";
import {
  VerificationEmail,
  ForgotPassword,
  ResetLinkSent,
  PasswordSetup,
  AcceptInvitation,
  InvitationVerification,
  InvitationUnavailable,
  AuthForm,
} from "@avgeek-oss/design-system";
import { toast } from "@avgeek-oss/design-system/overlays/toast";
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
export function VerificationEmailForm() {
  return (
    <VerificationEmail
      brand={<AuthBrand />}
      onBackToSignIn={() => window.location.assign("/login")}
      onSubmit={async ({ email }) => {
        const result = await api.post<{ status: boolean }>(
          "/v1/public/auth/request-verification-email",
          { email },
        );
        if (result?.status !== true)
          throw new Error("Verification email was not requested. Try again.");
      }}
    />
  );
}
export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const back = () => window.location.assign("/login");
  return sent ? (
    <ResetLinkSent brand={<AuthBrand />} onBackToSignIn={back} />
  ) : (
    <ForgotPassword
      brand={<AuthBrand />}
      onBackToSignIn={back}
      onSubmit={async ({ email }) => {
        await api.post("/v1/public/auth/identity/request-password-reset", {
          email,
          redirectTo: `${window.location.origin}/reset-password`,
        });
        setSent(true);
      }}
    />
  );
}
export function ResetPasswordForm() {
  const params = useSearchParams();
  const token = params.get("token");
  const [complete, setComplete] = useState(false);
  if (token && !complete)
    return (
      <PasswordSetup
        brand={<AuthBrand />}
        onBackToSignIn={() => window.location.assign("/login")}
        onSubmit={async ({ password }) => {
          await api.post("/v1/public/auth/identity/reset-password", {
            token,
            newPassword: password,
          });
          window.history.replaceState(null, "", "/reset-password");
          setComplete(true);
        }}
      />
    );
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
async function requestInvitationVerification(invitationId: string) {
  const result = await api.post<{ existingAccount: boolean }>(
    `/v1/public/auth/invitations/${invitationId}/verify`,
    {},
  );
  if (typeof result?.existingAccount !== "boolean")
    throw new Error("Invitation verification was not completed. Try again.");
  return result;
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
  const [verifyPending, setVerifyPending] = useState(false);
  const verifyRequestPending = useRef(false);
  const [existing, setExisting] = useState(false);
  const [sent, setSent] = useState(false);
  const self = `/invite/${invitationId}`;
  if (query.error)
    return (
      <InvitationUnavailable
        brand={<AuthBrand />}
        onBackToSignIn={() => window.location.assign("/login")}
      />
    );
  if (!query.data || !session.data) return <QueryLoading />;
  const invitation = query.data.invitation;
  const account = session.data.account;
  if (!account && verifying)
    return (
      <InvitationVerification
        brand={<AuthBrand />}
        teamName={invitation.teamName}
        maxNameLength={120}
        onResendCode={async () => {
          const result = await requestInvitationVerification(invitationId);
          if (result.existingAccount) {
            setExisting(true);
            setVerifying(false);
          }
        }}
        onSubmit={async (values) => {
          await api.post(
            `/v1/public/auth/invitations/${invitationId}/signup`,
            values,
          );
          window.location.replace("/first-password");
        }}
      />
    );
  if (!account && !existing)
    return (
      <AcceptInvitation
        brand={<AuthBrand />}
        teamName={invitation.teamName}
        role={roleLabels[invitation.role]}
        isPending={verifyPending}
        onBackToSignIn={() =>
          window.location.assign(`/login?next=${encodeURIComponent(self)}`)
        }
        onVerifyEmail={async () => {
          if (verifyRequestPending.current) return;
          verifyRequestPending.current = true;
          setVerifyPending(true);
          try {
            const result = await requestInvitationVerification(invitationId);
            setExisting(result.existingAccount);
            setVerifying(!result.existingAccount);
          } catch (error) {
            toast.danger(
              error instanceof Error
                ? error.message
                : "Unable to verify invitation",
            );
          } finally {
            verifyRequestPending.current = false;
            setVerifyPending(false);
          }
        }}
      />
    );
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
      ) : existing ? (
        <p>
          An account already exists for this email. Sign in to accept your
          invitation.
        </p>
      ) : null}
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
