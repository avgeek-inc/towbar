import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { normalizeServerConfiguration } from "../../packages/towbar-core/dist/index.js";
import {
  reconcileLogDrains,
  scanHostKeys,
} from "../../packages/towbar-deployer/dist/index.js";
import { startTestTarget } from "./target.mjs";
const target = await startTestTarget();
try {
  const serverId = randomUUID();
  const config = normalizeServerConfiguration({
    ip: "127.0.0.1",
    ssh: { username: "deploy", port: target.port },
  });
  const context = {
    serverId,
    config,
    login: { privateKey: readFileSync(target.key, "utf8") },
    trustedHostKeys: await scanHostKeys(config),
    targets: [
      {
        containerName: "not-running-log-test",
        appId: randomUUID(),
        name: "Log test",
        environment: "production",
        providers: ["newrelic"],
      },
    ],
    credentials: [
      {
        provider: "newrelic",
        region: "us",
        apiKey: `test-only-${randomUUID()}`,
      },
    ],
  };
  const name = `towbar-log-drains-${serverId}`,
    base = `/var/lib/towbar/log-drains/${serverId}`;
  const first = await reconcileLogDrains(context);
  assert(first.active);
  assert.equal(
    target.ssh(`sudo stat -c '%a' ${base}/config/vector.json`),
    "600",
  );
  assert.equal(target.ssh(`sudo stat -c '%a' ${base}`), "700");
  assert.equal(
    target.ssh(`docker inspect -f '{{.HostConfig.ReadonlyRootfs}}' ${name}`),
    "true",
  );
  assert.equal(
    target.ssh(`docker inspect -f '{{.HostConfig.Memory}}' ${name}`),
    String(256 * 1024 * 1024),
  );
  const started = target.ssh(`docker inspect -f '{{.Id}}' ${name}`);
  assert.deepEqual(await reconcileLogDrains(context), first);
  assert.equal(target.ssh(`docker inspect -f '{{.Id}}' ${name}`), started);
  const rotated = {
    ...context,
    credentials: [
      { ...context.credentials[0], apiKey: `rotated-${randomUUID()}` },
    ],
  };
  const second = await reconcileLogDrains(rotated);
  assert.notEqual(first.digest, second.digest);
  assert.notEqual(target.ssh(`docker inspect -f '{{.Id}}' ${name}`), started);
  await assert.rejects(
    reconcileLogDrains({ ...rotated, trustedHostKeys: [] }),
    /not.*trusted/i,
  );
  const removed = await reconcileLogDrains({
    ...rotated,
    targets: [],
    credentials: [],
  });
  assert.equal(removed.active, false);
  assert.equal(target.ssh(`docker ps -a -q --filter name=${name}`), "");
  target.ssh(
    `sudo test ! -e ${base}/config/vector.json && sudo test ! -e ${base}/buffer`,
  );
  console.log(
    "Pinned non-root SSH installation, idempotency, rotation, hardening and removal passed.",
  );
} finally {
  target.close();
}
