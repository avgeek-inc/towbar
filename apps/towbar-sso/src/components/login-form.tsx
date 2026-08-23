"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { IdentityCredentialsForm } from "@workspace/identity-web-ui/identity-credentials-form";
import { AuthFrame } from "@/components/auth-frame";
import { api } from "@/lib/api";
import { config } from "@/lib/config";

export function LoginForm() {
  const params = useSearchParams();
  const candidate = params.get("redirectUri");
  const redirectUri = safeRedirect(candidate);
  return (
    <AuthFrame
      description="Use the private owner account configured by the operator."
      title="Sign in"
    >
      <IdentityCredentialsForm
        identifierLabel="Email"
        identifierType="email"
        passwordAction={
          <Link
            className="typography--body-sm underline-offset-4 pointer-fine:hover:underline"
            href="/forgot-password"
          >
            Forgot password?
          </Link>
        }
        onSubmit={async ({ identifier, password }) => {
          const result = await api.post<{
            authorizationCode: string;
            redirectUri: string;
          }>("/v1/public/auth/login-email", {
            email: identifier,
            password,
            redirectUri,
          });
          const target = new URL(result.redirectUri);
          target.searchParams.set(
            "authorizationCode",
            result.authorizationCode,
          );
          window.location.assign(target);
        }}
      />
      <p className="text-muted typography--body-sm">
        Towbar is private. New accounts cannot be created here.
      </p>
    </AuthFrame>
  );
}
function safeRedirect(candidate: string | null) {
  const fallback = `${config.appBaseUrl}/auth/callback`;
  if (!candidate) return fallback;
  try {
    const url = new URL(candidate);
    return url.origin === new URL(config.appBaseUrl).origin
      ? url.toString()
      : fallback;
  } catch {
    return fallback;
  }
}
