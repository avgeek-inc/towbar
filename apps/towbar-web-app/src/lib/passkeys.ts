"use client";
import {
  startAuthentication,
  startRegistration,
  browserSupportsWebAuthn,
  WebAuthnAbortService,
} from "@simplewebauthn/browser";
import { api } from "./api";
const endpoint = "/v1/public/auth/identity/passkey";
export function passkeySupported() {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    browserSupportsWebAuthn()
  );
}
function requireSupport() {
  if (!passkeySupported())
    throw new Error(
      "Passkeys require a supported browser on HTTPS or localhost.",
    );
}
export async function registerPasskey(name: string, email: string) {
  requireSupport();
  const options = await api.get<
    Parameters<typeof startRegistration>[0]["optionsJSON"]
  >(`${endpoint}/generate-register-options`);
  const response = await startRegistration({
    optionsJSON: {
      ...options,
      user: { ...options.user, name: email, displayName: email },
    },
  });
  await api.post(`${endpoint}/verify-registration`, { name, response });
}
export async function verifyPasskeySecondFactor(signal: AbortSignal) {
  requireSupport();
  const options = await api.get<
    Parameters<typeof startAuthentication>[0]["optionsJSON"]
  >(`${endpoint}/generate-authenticate-options`);
  signal.throwIfAborted();
  const cancel = () => WebAuthnAbortService.cancelCeremony();
  signal.addEventListener("abort", cancel, { once: true });
  let response;
  try {
    response = await startAuthentication({
      optionsJSON: { ...options, userVerification: "required" },
    });
  } finally {
    signal.removeEventListener("abort", cancel);
  }
  signal.throwIfAborted();
  await api.post(`${endpoint}/verify-authentication`, { response });
}
export function passkeyError(error: unknown) {
  if (
    error instanceof Error &&
    (error.name === "NotAllowedError" || error.name === "AbortError")
  )
    return "The passkey request was cancelled or timed out. You can try again.";
  return error instanceof Error
    ? error.message
    : "Could not use this passkey. Try again.";
}
