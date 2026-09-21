import { randomUUID } from "node:crypto";
import {
  generateRegistrationOptions,
  generateAuthenticationOptions,
  verifyRegistrationResponse,
  verifyAuthenticationResponse,
  type WebAuthnCredential,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
} from "@simplewebauthn/server";

type FixturePasskey = {
  id: string;
  userId: string;
  name: string;
  createdAt: string;
  credential: WebAuthnCredential;
};

export function createPasskeyFixture(
  currentUser: () => { id: string; email: string; name: string } | null,
  signIn: (id: string) => void,
  pendingSignIn: () => { id: string; userId: string; expiresAt: number } | null,
  seededKeys: FixturePasskey[] = [],
) {
  const keys = structuredClone(seededKeys);
  let challenge: {
    value: string;
    userId: string | null;
    type: string;
    expiresAt: number;
    signInId?: string;
  } | null = null;
  const origin = process.env.TOWBAR_APP_BASE_URL ?? "http://localhost:4021";
  const rpID = new URL(origin).hostname;
  return {
    hasPasskey: (userId: string) => keys.some((key) => key.userId === userId),
    async handle(
      action: string,
      input: Record<string, unknown>,
    ): Promise<unknown> {
      const user = currentUser();
      const current = user?.id ?? null;
      if (
        !action.endsWith("generate-authenticate-options") &&
        !action.endsWith("verify-authentication") &&
        !current
      )
        throw new Error("Sign in to manage passkeys");
      if (action === "passkey/list-user-passkeys")
        return keys
          .filter((key) => key.userId === current)
          .map(({ id, name, createdAt }) => ({ id, name, createdAt }));
      if (action === "passkey/generate-register-options") {
        const result = await generateRegistrationOptions({
          rpName: "Towbar fixture",
          rpID,
          userName: user!.email,
          userDisplayName: user!.name,
          authenticatorSelection: {
            residentKey: "required",
            userVerification: "required",
          },
          excludeCredentials: keys
            .filter((key) => key.userId === current)
            .map((key) => ({ id: key.credential.id })),
        });
        challenge = {
          value: result.challenge,
          userId: current,
          type: "registration",
          expiresAt: Date.now() + 300000,
        };
        return result;
      }
      if (action === "passkey/generate-authenticate-options") {
        const pending = pendingSignIn();
        if (!pending || pending.expiresAt < Date.now())
          throw new Error("Sign in with your email and password first");
        if (!keys.some((key) => key.userId === pending.userId))
          throw new Error("No passkey is available for this account");
        const result = await generateAuthenticationOptions({
          rpID,
          userVerification: "required",
          allowCredentials: keys
            .filter((key) => key.userId === pending.userId)
            .map((key) => ({ id: key.credential.id })),
        });
        challenge = {
          value: result.challenge,
          userId: pending.userId,
          signInId: pending.id,
          type: "authentication",
          expiresAt: Date.now() + 300000,
        };
        return result;
      }
      if (action === "passkey/verify-registration") {
        const pending = challenge;
        challenge = null;
        if (
          !pending ||
          pending.type !== "registration" ||
          pending.userId !== current ||
          pending.expiresAt < Date.now()
        )
          throw new Error("Passkey request expired");
        const result = await verifyRegistrationResponse({
          response: input.response as RegistrationResponseJSON,
          expectedChallenge: pending.value,
          expectedOrigin: origin,
          expectedRPID: rpID,
          requireUserVerification: true,
        });
        if (!result.verified || !result.registrationInfo)
          throw new Error("Passkey could not be verified");
        const key = {
          id: randomUUID(),
          userId: current!,
          name: String(input.name),
          createdAt: new Date().toISOString(),
          credential: result.registrationInfo.credential,
        };
        keys.push(key);
        return { id: key.id, name: key.name, createdAt: key.createdAt };
      }
      if (action === "passkey/verify-authentication") {
        const password = pendingSignIn();
        const pending = challenge;
        challenge = null;
        const response = input.response as AuthenticationResponseJSON;
        const key = keys.find((key) => key.credential.id === response.id);
        if (
          !pending ||
          pending.type !== "authentication" ||
          !key ||
          !password ||
          password.expiresAt < Date.now() ||
          password.id !== pending.signInId ||
          password.userId !== key.userId ||
          pending.userId !== key.userId ||
          pending.expiresAt < Date.now()
        )
          throw new Error("Passkey request expired");
        const result = await verifyAuthenticationResponse({
          response,
          expectedChallenge: pending.value,
          expectedOrigin: origin,
          expectedRPID: rpID,
          credential: key.credential,
          requireUserVerification: true,
        });
        if (!result.verified) throw new Error("Passkey could not be verified");
        key.credential.counter = result.authenticationInfo.newCounter;
        signIn(key.userId);
        return { success: true };
      }
      const index = keys.findIndex(
        (key) => key.id === input.id && key.userId === current,
      );
      if (index < 0) throw new Error("Passkey not found");
      if (action === "passkey/delete-passkey") keys.splice(index, 1);
      else if (action === "passkey/update-passkey")
        keys[index]!.name = String(input.name);
      else throw new Error("Unknown passkey action");
      return { success: true };
    },
  };
}
