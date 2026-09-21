import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { normalizeServerConfiguration } from "../../packages/towbar-core/dist/index.js";
import {
  cleanupPreviewEnvironment,
  scanHostKeys,
} from "../../packages/towbar-deployer/dist/index.js";
import { startTestTarget } from "./target.mjs";

const target = await startTestTarget({ systemd: true });
try {
  const runtimeId = randomUUID();
  const productionId = randomUUID();
  const server = normalizeServerConfiguration({
    ip: "127.0.0.1",
    ssh: { username: "deploy", port: target.port },
  });
  const trustedHostKeys = await scanHostKeys(server);
  const write = (file, value) =>
    target.ssh(
      `printf '%s' '${Buffer.from(value).toString("base64")}' | base64 -d | sudo tee '${file}' >/dev/null`,
    );
  target.ssh("docker pull alpine:3.22");
  for (const [name, id] of [
    ["production", productionId],
    ["preview", runtimeId],
    ["orphan", runtimeId],
  ]) {
    write(
      `/tmp/${name}.Dockerfile`,
      `FROM alpine:3.22\nLABEL towbar.app=${id}\nLABEL test.candidate=${name}\nCMD ["sleep", "infinity"]\n`,
    );
    target.ssh(
      `docker build -t test-${name}:latest -f /tmp/${name}.Dockerfile /tmp >/dev/null && docker run -d --name test-${name} --label towbar.app=${id} test-${name}:latest`,
    );
  }
  write(
    `/etc/caddy/towbar/${productionId}.caddy`,
    ':8088 {\n respond "production"\n}\n',
  );
  write(
    `/etc/caddy/towbar/${runtimeId}.caddy`,
    ':8089 {\n respond "preview"\n}\n',
  );
  target.ssh("sudo systemctl reload caddy");
  assert.equal(
    target.ssh("curl --fail --silent http://127.0.0.1:8088"),
    "production",
  );
  assert.equal(
    target.ssh("curl --fail --silent http://127.0.0.1:8089"),
    "preview",
  );
  const input = {
    context: {
      runtimeId,
      server,
      trustedHostKeys,
      hostname: "preview.example.test",
      containerNames: ["test-preview"],
      imageTags: ["test-preview:latest"],
    },
    login: { privateKey: readFileSync(target.key, "utf8") },
  };
  await cleanupPreviewEnvironment(input);
  assert.equal(
    target.ssh("docker ps -a --format '{{.Names}}'"),
    "test-production",
  );
  assert.equal(
    target.ssh(`docker image ls --filter label=towbar.app=${runtimeId} -q`),
    "",
  );
  target.ssh(`sudo test ! -e /etc/caddy/towbar/${runtimeId}.caddy`);
  assert.equal(
    target.ssh("curl --fail --silent http://127.0.0.1:8088"),
    "production",
  );
  assert.throws(() =>
    target.ssh("curl --fail --silent --max-time 2 http://127.0.0.1:8089"),
  );
  await cleanupPreviewEnvironment(input);
  assert.equal(target.ssh("sudo systemctl is-active caddy"), "active");
  assert.equal(
    target.ssh("curl --fail --silent http://127.0.0.1:8088"),
    "production",
  );
  console.log(
    "Preview cleanup removes tracked and orphan runtimes, reloads real Caddy, preserves production, and safely repeats.",
  );
} finally {
  target.close();
}
