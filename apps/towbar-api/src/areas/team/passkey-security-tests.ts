import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import * as schema from "@workspace/towbar-database/schema";
import { totp } from "./authentication-security-tests.js";
import { testAuthenticator } from "./webauthn-test-authenticator.js";
import type { settingsTestClient } from "./settings-test-client.js";
import type { getTowbarDatabase } from "../../infrastructure/database.js";

export async function verifyPasskeySecurity({
  database,
  auth,
  adminHeaders,
  memberHeaders,
  publicHeaders,
  adminId,
  origin,
  password,
  client,
}: {
  database: ReturnType<typeof getTowbarDatabase>;
  auth: typeof import("../auth/service.js");
  adminHeaders: Headers;
  memberHeaders: Headers;
  publicHeaders: Headers;
  adminId: string;
  origin: string;
  password: string;
  client: ReturnType<typeof settingsTestClient>;
}) {
  const { cookies, request, ok, passkeyOptions } = client;
  const endpoint = "/v1/public/auth/identity/passkey";
  const authenticator = testAuthenticator();
  const options = passkeyOptions(endpoint, adminHeaders);
  assert.equal(
    (
      await request(endpoint + "/verify-authentication", publicHeaders, {
        response: null,
      })
    ).status,
    400,
  );
  const currentSession = (await auth.findSession(adminHeaders))!;
  await database
    .update(schema.sessions)
    .set({
      createdAt: new Date(Date.now() - 7200000),
      authenticatedAt: new Date(Date.now() - 700000),
    })
    .where(eq(schema.sessions.id, currentSession.sessionId));
  assert.equal(
    (await request(endpoint + "/generate-register-options", adminHeaders))
      .status,
    403,
  );
  await ok(
    await request("/v1/core/session/reauthenticate", adminHeaders, {
      password,
    }),
  );
  let registration = await options("/generate-register-options");
  assert.equal(
    (
      await request(endpoint + "/verify-registration", registration.headers, {
        name: "Test key",
        response: authenticator.registration(
          registration.data.challenge,
          origin,
          false,
        ),
      })
    ).ok,
    false,
  );
  registration = await options("/generate-register-options");
  assert.equal(
    (
      await request(endpoint + "/verify-registration", registration.headers, {
        name: "Test key",
        response: authenticator.registration(
          registration.data.challenge,
          "https://wrong-origin.test",
        ),
      })
    ).ok,
    false,
  );
  registration = await options("/generate-register-options");
  const payload = {
    name: "Test key",
    response: authenticator.registration(registration.data.challenge, origin),
  };
  await ok(
    await request(
      endpoint + "/verify-registration",
      registration.headers,
      payload,
    ),
  );
  assert.equal(
    (
      await request(
        endpoint + "/verify-registration",
        registration.headers,
        payload,
      )
    ).ok,
    false,
  );
  const keys = (await (
    await ok(await request(endpoint + "/list-user-passkeys", adminHeaders))
  ).json()) as Array<{ id: string }>;
  assert.equal(keys.length, 1);
  assert.equal(
    (
      await request(endpoint + "/delete-passkey", memberHeaders, {
        id: keys[0]!.id,
      })
    ).ok,
    false,
  );
  const listed = await (
    await ok(await request(endpoint + "/list-user-passkeys", memberHeaders))
  ).json();
  assert.deepEqual(listed, []);
  for (const headers of [publicHeaders, adminHeaders]) {
    assert.equal(
      (await request(endpoint + "/generate-authenticate-options", headers))
        .status,
      401,
    );
    assert.equal(
      (
        await request(endpoint + "/verify-authentication", headers, {
          response: authenticator.authentication("no-password", origin),
        })
      ).ok,
      false,
    );
  }
  const passwordChallenge = async (methods = ["passkey"]) => {
    const response = await ok(
      await request("/v1/public/auth/login-email", publicHeaders, {
        email: "admin@settings.test",
        password,
      }),
    );
    assert.deepEqual(await response.clone().json(), {
      twoFactorRequired: true,
      twoFactorMethods: methods,
      user: null,
    });
    const headers = cookies(response);
    assert.equal(await auth.findSession(headers), null);
    return headers;
  };
  const pendingHeaders = await passwordChallenge();
  let challenge = await options(
    "/generate-authenticate-options",
    pendingHeaders,
  );
  assert.equal(
    (
      await request(endpoint + "/verify-authentication", challenge.headers, {
        response: authenticator.authentication(
          challenge.data.challenge,
          origin,
          1,
          false,
        ),
      })
    ).ok,
    false,
  );
  challenge = await options("/generate-authenticate-options", pendingHeaders);
  const signed = {
    response: authenticator.authentication(challenge.data.challenge, origin),
  };
  const attempts = await Promise.all([
    request(endpoint + "/verify-authentication", challenge.headers, signed),
    request(endpoint + "/verify-authentication", challenge.headers, signed),
  ]);
  assert.equal(attempts.filter((response) => response.ok).length, 1);
  const session = await auth.findSession(
    cookies(attempts.find((response) => response.ok)!),
  );
  assert.equal(session?.user.id, adminId);
  assert.equal(
    (await request(endpoint + "/generate-authenticate-options", pendingHeaders))
      .status,
    401,
  );

  // A signed WebAuthn response cannot be carried into a different password attempt.
  const firstAttempt = await passwordChallenge();
  const firstOptions = await options(
    "/generate-authenticate-options",
    firstAttempt,
  );
  const secondAttempt = await passwordChallenge();
  const mixed = new Headers(firstOptions.headers);
  const factor = secondAttempt
    .get("cookie")!
    .split("; ")
    .find((value) => value.startsWith("towbar.two_factor="))!;
  assert(factor);
  mixed.set(
    "cookie",
    firstOptions.headers
      .get("cookie")!
      .split("; ")
      .filter((value) => !value.startsWith("towbar.two_factor="))
      .concat(factor)
      .join("; "),
  );
  assert.equal(
    (
      await request(endpoint + "/verify-authentication", mixed, {
        response: authenticator.authentication(
          firstOptions.data.challenge,
          origin,
          2,
        ),
      })
    ).ok,
    false,
  );

  // A different account's credential cannot complete this account's challenge.
  const pendingOther = await passwordChallenge();
  const otherOptions = await options(
    "/generate-authenticate-options",
    pendingOther,
  );
  const otherId = (await auth.findSession(memberHeaders))!.user.id;
  await database
    .update(schema.authPasskeys)
    .set({ userId: otherId })
    .where(eq(schema.authPasskeys.id, keys[0]!.id));
  assert.equal(
    (
      await request(endpoint + "/verify-authentication", otherOptions.headers, {
        response: authenticator.authentication(
          otherOptions.data.challenge,
          origin,
          2,
        ),
      })
    ).ok,
    false,
  );
  await database
    .update(schema.authPasskeys)
    .set({ userId: adminId })
    .where(eq(schema.authPasskeys.id, keys[0]!.id));

  const expired = await passwordChallenge();
  await database
    .update(schema.authVerifications)
    .set({ expiresAt: new Date(0) })
    .where(eq(schema.authVerifications.value, adminId));
  assert.equal(
    (await request(endpoint + "/generate-authenticate-options", expired))
      .status,
    401,
  );

  const factorSetup = (await (
    await ok(
      await request("/v1/core/profile/two-factor/setup", adminHeaders, {}),
    )
  ).json()) as { totpURI: string };
  const secret = new URL(factorSetup.totpURI).searchParams.get("secret")!;
  const verified = await ok(
    await request(
      "/v1/public/auth/identity/two-factor/verify-totp",
      adminHeaders,
      { code: totp(secret) },
    ),
  );
  adminHeaders = cookies(verified, adminHeaders);
  const both = await passwordChallenge(["totp", "passkey"]);
  const bothOptions = await options("/generate-authenticate-options", both);
  const completed = await ok(
    await request("/v1/public/auth/identity/two-factor/verify-totp", both, {
      code: totp(secret),
    }),
  );
  assert.equal((await auth.findSession(cookies(completed)))?.user.id, adminId);
  assert.equal(
    (
      await request(endpoint + "/verify-authentication", bothOptions.headers, {
        response: authenticator.authentication(
          bothOptions.data.challenge,
          origin,
          2,
        ),
      })
    ).ok,
    false,
  );
  await ok(
    await request("/v1/core/profile/two-factor/manage", adminHeaders, {
      action: "disable",
      code: totp(secret),
    }),
  );

  await ok(
    await request(endpoint + "/update-passkey", adminHeaders, {
      id: keys[0]!.id,
      name: "Renamed key",
    }),
  );
  challenge = await options(
    "/generate-authenticate-options",
    await passwordChallenge(),
  );
  await ok(
    await request(endpoint + "/delete-passkey", adminHeaders, {
      id: keys[0]!.id,
    }),
  );
  assert.equal(
    (
      await request(endpoint + "/verify-authentication", challenge.headers, {
        response: authenticator.authentication(
          challenge.data.challenge,
          origin,
          2,
        ),
      })
    ).ok,
    false,
  );
  return adminHeaders;
}
