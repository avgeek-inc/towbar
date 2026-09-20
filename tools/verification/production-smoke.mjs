import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const api = process.env.VERIFY_API_URL;
const app = process.env.VERIFY_APP_URL;
const code = process.env.VERIFY_SETUP_CODE;
assert.ok(
  api && app && code,
  "The disposable production runner must supply setup context",
);
for (const endpoint of [api, app]) {
  const url = new URL(endpoint);
  assert.equal(
    url.hostname,
    "127.0.0.1",
    "Production smoke tests only target loopback",
  );
  assert.equal(url.protocol, "http:");
}
const cookies = new Map();
async function request(path, data, origin = app) {
  const response = await fetch(`${api}${path}`, {
    method: data === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      // The isolated stack uses loopback HTTP; forwarding Secure cookies here
      // tests the API session, not a browser's HTTPS or cookie policy.
      Cookie: [...cookies]
        .map(([name, value]) => `${name}=${value}`)
        .join("; "),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(15_000),
    redirect: "error",
  });
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(";", 1)[0];
    const separator = pair.indexOf("=");
    cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
  return { status: response.status, body: await response.json() };
}
function check(name, condition) {
  assert.ok(condition, name);
  console.log(`PASS ${name}`);
}

const setupPage = await fetch(`${app}/setup`, {
  signal: AbortSignal.timeout(15_000),
});
check(
  "Production web application renders setup",
  setupPage.status === 200 && (await setupPage.text()).includes("Towbar"),
);
let response = await request("/v1/public/auth/setup-status");
check(
  "Fresh database requires setup",
  response.status === 200 && response.body.setupRequired === true,
);
response = await request("/v1/core/team");
check("Anonymous team access is denied", response.status === 401);

const password = `${randomBytes(24).toString("base64url")}Aa1!`;
const data = {
  teamName: "Disposable Verification Team",
  displayName: "Verification Admin",
  email: "verification@example.invalid",
  password,
  confirmPassword: password,
  setupCode: code,
};
response = await request(
  "/v1/public/auth/setup",
  data,
  "https://untrusted.example.invalid",
);
check("Cross-origin setup is rejected", response.status === 403);
response = await request("/v1/public/auth/setup", data);
check(
  "Production setup creates the first administrator",
  response.status === 201,
);
response = await request("/v1/public/auth/state");
check(
  "Authenticated session has the admin role",
  response.status === 200 && response.body.user?.workspaceRole === "admin",
);
response = await request("/v1/core/team");
check(
  "Team settings persist in the production database",
  response.status === 200 && response.body.team?.name === data.teamName,
);
response = await request("/v1/core/team/members");
check("Administrator can read the membership list", response.status === 200);
response = await request("/v1/public/auth/setup-status");
check(
  "Setup closes after the first administrator",
  response.status === 200 && response.body.setupRequired === false,
);
response = await request("/v1/public/auth/setup", data);
check("The setup ceremony cannot be replayed", response.status === 409);
