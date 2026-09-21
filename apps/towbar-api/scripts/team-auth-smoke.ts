import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
const url = process.env.TOWBAR_TEAM_TEST_DATABASE_URL;
assert(url && new URL(url).pathname.endsWith("_test"));
process.env.DATABASE_TOWBAR_URL = url;
process.env.TOWBAR_CREDENTIALS_KEY = randomBytes(32).toString("base64");
process.env.TOWBAR_INTERNAL_HMAC_SECRET = randomBytes(32).toString("hex");
process.env.TOWBAR_PASSWORD_BREACH_CHECK = "false";
const {
  createInitialAdmin,
  authenticatePassword,
  issueSetupCode,
  findSession,
  getInitialSetupStatus,
} = await import("../src/areas/auth/service.js");
const { closeDatabase } = await import("../src/infrastructure/database.js");
const { createApiKey, findApiKey } =
  await import("../src/areas/api-keys/service.js");
try {
  const setup = (await getInitialSetupStatus()).setupRequired;
  const code = setup ? await issueSetupCode() : "";
  const response = setup
    ? await createInitialAdmin({
        teamName: "Team access verification",
        displayName: "First admin",
        email: "initial@example.test",
        password: "A unique test password for team access",
        setupCode: code,
      })
    : await authenticatePassword({
        email: "initial@example.test",
        password: "A unique test password for team access",
      });
  assert.equal(response.status, 200);
  const cookie = response.headers
    .getSetCookie()
    .map((v) => v.split(";")[0])
    .join("; ");
  const identity = await findSession(new Headers({ cookie }));
  assert.equal(identity?.user.workspaceRole, "admin");
  assert.equal(identity?.user.teamName, "Team access verification");
  assert.equal((await getInitialSetupStatus()).setupRequired, false);
  const personal = await createApiKey(identity!.user, {
    name: "Personal test",
    access: "edit",
  });
  assert.equal(
    (await findApiKey(personal.token ?? ""))?.actor.kind,
    "personal-key",
  );
  const team = await createApiKey(identity!.user, {
    name: "Team test",
    scope: "team",
    access: "edit",
    includeAdmin: true,
  });
  assert.equal((await findApiKey(team.token ?? ""))?.actor.kind, "team-key");
  console.log(
    "Production auth schema: bootstrap, cookie session, live role, personal key and team key passed",
  );
} finally {
  await closeDatabase();
}
