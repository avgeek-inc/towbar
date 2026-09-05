import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";

import { CommandError } from "./process.js";

import {
  preparationErrorMessage,
  serverPreparationScripts,
} from "./server-preparation.js";

void test("uses signed upstream package repositories and pinned Caddy inputs", () => {
  assert.match(
    serverPreparationScripts.installDocker,
    /https:\/\/download\.docker\.com\/linux\/ubuntu/,
  );
  assert.doesNotMatch(
    serverPreparationScripts.installDocker,
    /get\.docker\.com/,
  );
  assert.match(
    serverPreparationScripts.installCaddy,
    /https:\/\/dl\.cloudsmith\.io\/public\/caddy\/stable/,
  );
  assert.match(serverPreparationScripts.installCaddy, /caddy:2\.11\.4-builder/);
  assert.match(serverPreparationScripts.installCaddy, /build v2\.11\.4/);
  assert.match(
    serverPreparationScripts.installCaddy,
    /github\.com\/caddy-dns\/cloudflare@v0\.2\.4/,
  );
});

void test("refuses conflicting installations instead of removing them", () => {
  assert.match(
    serverPreparationScripts.installDocker,
    /Remove the conflicting installation before continuing/,
  );
  assert.match(
    serverPreparationScripts.installCaddy,
    /Remove it or use a fresh server/,
  );
  assert.doesNotMatch(
    serverPreparationScripts.installDocker,
    /apt-get\s+(?:-\w+\s+)*remove/,
  );
  assert.doesNotMatch(
    serverPreparationScripts.installDocker,
    /apt-get\s+(?:-\w+\s+)*purge/,
  );
});

void test("requires pinned SSH trust and verifies the installed services", () => {
  assert.match(serverPreparationScripts.inspectServer, /Ubuntu 22\.04/);
  assert.match(
    serverPreparationScripts.inspectServer,
    /sudo -n true 2>\/dev\/null/,
  );
  assert.match(serverPreparationScripts.verifyServer, /systemctl is-active/);
  assert.match(serverPreparationScripts.verifyServer, /docker info/);
  assert.match(serverPreparationScripts.verifyServer, /caddy validate/);
  assert.match(serverPreparationScripts.verifyServer, /python3/);
});

void test("keeps package-manager progress out of preparation step messages", () => {
  assert.match(
    serverPreparationScripts.installPrerequisites,
    /python3 sudo >\/dev\/null/,
  );
  assert.match(
    serverPreparationScripts.installDocker,
    /docker-compose-plugin \\\s+>\/dev\/null/,
  );
  assert.match(serverPreparationScripts.installCaddy, /caddy >\/dev\/null/);
});

void test("fully consumes Caddy module output under pipefail", () => {
  for (const script of [
    serverPreparationScripts.installCaddy,
    serverPreparationScripts.verifyServer,
  ]) {
    assert.match(script, /grep -Fx dns\.providers\.cloudflare >\/dev\/null/);
    assert.doesNotMatch(script, /grep -Fxq dns\.providers\.cloudflare/);
  }
});

void test("validates with the installed Caddy environment and supports a fresh server", () => {
  const script = serverPreparationScripts.verifyServer;
  const validation = script.slice(
    script.indexOf("validate_args="),
    script.indexOf("disk_available="),
  );
  for (const envExists of [true, false]) {
    const output = execFileSync(
      "bash",
      [
        "-c",
        `
set -euo pipefail
SUDO=(privileged)
privileged() {
  if test "$1" = test; then return ${envExists ? 0 : 1}; fi
  test "$1" = caddy
  test "$2" = validate
  test "$3" = --config
  test "$4" = /etc/caddy/Caddyfile
  test "$#" -eq ${envExists ? 6 : 4}
  ${envExists ? 'test "$5" = --envfile; test "$6" = /etc/caddy/towbar/cloudflare.env' : ":"}
}
${validation}
`,
      ],
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    );
    assert.equal(output, "");
  }
});

void test("preserves the Caddy failure after noisy startup output and redacts tokens", () => {
  const noise = Array.from({ length: 30 }, () =>
    JSON.stringify({ level: "info", msg: "starting certificate maintenance" }),
  ).join("\n");
  const error = new CommandError(
    "bash exited unsuccessfully",
    "",
    `${noise}\nError: loading DNS provider: API token 'sensitive-token' appears invalid`,
  );
  assert.equal(
    preparationErrorMessage(error),
    "Error: loading DNS provider: API token '[redacted]' appears invalid",
  );
});

void test("retains the end of long diagnostics and actual conflict guidance", () => {
  const message = preparationErrorMessage(
    new CommandError(
      "failed",
      "",
      `Error: ${"nested module: ".repeat(100)}certificate could not be loaded`,
    ),
  );
  assert.equal(message.length, 800);
  assert.ok(message.endsWith("certificate could not be loaded"));
  const conflict =
    "An incompatible Docker installation is already present. Remove the conflicting installation before continuing.";
  assert.equal(
    preparationErrorMessage(new CommandError("failed", "", conflict)),
    conflict,
  );
  assert.equal(
    preparationErrorMessage(new Error("SSH connection timed out")),
    "SSH connection timed out",
  );
});
