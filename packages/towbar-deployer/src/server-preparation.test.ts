import assert from "node:assert/strict";
import test from "node:test";

import { serverPreparationScripts } from "./server-preparation.js";

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
