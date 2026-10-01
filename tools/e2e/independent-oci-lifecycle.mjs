import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  resolveRepositoryEnvironment,
  normalizeServerConfiguration,
} from "../../packages/towbar-core/dist/index.js";
import {
  executeDeployment,
  scanHostKeys,
} from "../../packages/towbar-deployer/dist/index.js";
import { prepareHistogram } from "../../examples/independent-oci/prepare-histogram.mjs";
import { startTestTarget } from "./target.mjs";

assert.equal(
  process.arch,
  "arm64",
  "This fixture validates Linux ARM64 image candidates",
);
const target = await startTestTarget();
const originalFetch = globalThis.fetch;
const password = randomUUID().replaceAll("-", "");
const pgPassword = randomUUID().replaceAll("-", "");
const adminPassword = `Fixture!Aa0${randomUUID().replaceAll("-", "")}`;
const chDsn = `tcp://default:${password}@clickhouse:9000`;
const pgDsn = `postgres://signoz:${pgPassword}@postgres:5432/signoz?sslmode=disable`;
const sensitive = [password, pgPassword, adminPassword, chDsn, pgDsn];
const redact = (value) =>
  sensitive.reduce(
    (text, secret) => text.replaceAll(secret, "[redacted]"),
    value,
  );
const deployed = [];
try {
  const checkout = path.join(target.directory, "checkout");
  cpSync(
    new URL("../../examples/independent-oci/", import.meta.url),
    checkout,
    { recursive: true },
  );
  await prepareHistogram(path.join(checkout, "config"));
  const files = ["services", "datastores"].flatMap((area) =>
    readdirSync(path.join(checkout, ".towbar", area)).map((name) => ({
      path: `.towbar/${area}/${name}`,
      content: readFileSync(path.join(checkout, ".towbar", area, name), "utf8"),
    })),
  );
  const { manifest } = resolveRepositoryEnvironment({
    root: readFileSync(path.join(checkout, "towbar.yml"), "utf8"),
    files,
    environment: "production",
    branch: "main",
  });
  const archivePath = path.join(target.directory, "snapshot.tar.gz");
  execFileSync(
    "tar",
    ["-czf", archivePath, "-C", target.directory, "checkout"],
    { env: { ...process.env, COPYFILE_DISABLE: "1" } },
  );
  const archive = readFileSync(archivePath);
  const commitSha = "a".repeat(40);
  globalThis.fetch = async (input) => {
    assert.equal(
      String(input),
      `https://api.github.com/repos/test/test/tarball/${commitSha}`,
    );
    return new Response(archive);
  };
  const server = normalizeServerConfiguration({
    ip: "127.0.0.1",
    ssh: { username: "deploy", port: target.port },
  });
  const trustedHostKeys = await scanHostKeys(server);
  const sourceId = randomUUID();
  const workspaceId = randomUUID();
  const serverId = randomUUID();
  const runtime = {
    keeper: {},
    postgres: {
      POSTGRES_USER: "signoz",
      POSTGRES_DB: "signoz",
      POSTGRES_PASSWORD: pgPassword,
    },
    clickhouse: {
      CLICKHOUSE_USER: "default",
      CLICKHOUSE_PASSWORD: password,
      CLICKHOUSE_CONFIG: "/etc/clickhouse-server/config-0-0.yaml",
      CLICKHOUSE_SKIP_USER_SETUP: "1",
    },
    collector: {
      SIGNOZ_OTEL_COLLECTOR_CLICKHOUSE_DSN: chDsn,
      SIGNOZ_OTEL_COLLECTOR_TIMEOUT: "2m",
    },
    signoz: {
      SIGNOZ_SQLSTORE_PROVIDER: "postgres",
      SIGNOZ_SQLSTORE_POSTGRES_DSN: pgDsn,
      SIGNOZ_TELEMETRYSTORE_PROVIDER: "clickhouse",
      SIGNOZ_TELEMETRYSTORE_CLICKHOUSE_DSN: chDsn,
    },
  };
  const entities = new Map(
    [...manifest.apps, ...manifest.resources].map((entity) => [
      entity.id,
      entity,
    ]),
  );
  // Operator ordering is explicit; Towbar still queues independent deployables.
  for (const id of [
    "keeper",
    "postgres",
    "clickhouse",
    "collector",
    "signoz",
  ]) {
    const app = { ...entities.get(id), server: server.ip };
    const result = await executeDeployment({
      context: {
        app,
        server,
        trustedHostKeys,
        sourceId,
        workspaceId,
        serverId,
        deployableId: randomUUID(),
        deploymentId: randomUUID(),
        commitSha,
        environment: "production",
        environmentName: "production",
        kind: "deploy",
        currentRelease: null,
        rollbackRelease: null,
        repositoryName: "test",
        repositoryOwner: "test",
        sourceCredential: {
          provider: "github",
          apiUrl: "https://api.github.com",
          token: "fixture-token",
        },
      },
      secrets: {
        login: { privateKey: readFileSync(target.key, "utf8") },
        build: {},
        runtime: runtime[id],
        hooks: {
          preDeploy: id === "collector" ? runtime.collector : {},
          postDeploy: {},
        },
        cloudflare: null,
      },
      hooks: {
        transition: async (state) => console.log(`${id}: ${state}`),
        log: async (content) => console.log(redact(content.trimEnd())),
        commitRelease: async (result) => ({
          retainedImageTags: [result.imageTag],
        }),
      },
    });
    deployed.push({ id, result });
    const inspect = JSON.parse(
      target.ssh(`docker inspect ${result.containerName}`),
    )[0];
    assert(inspect.State.Running);
    assert.equal(
      inspect.NetworkSettings.Networks["independent-oci"].Aliases.includes(id),
      true,
    );
    assert(
      inspect.Mounts.filter((mount) => mount.Type === "bind").every(
        (mount) => mount.RW === false,
      ),
    );
    if (id === "collector") {
      assert(inspect.NetworkSettings.Ports["4318/tcp"]);
      assert(inspect.NetworkSettings.Ports["13133/tcp"]);
      assert.equal(
        target.ssh(
          "docker ps -a --filter name=-hook-predeploy --format '{{.Names}}'",
        ),
        "",
      );
    }
  }
  const signoz = deployed.find((item) => item.id === "signoz").result;
  assert.equal(
    JSON.parse(
      target.ssh(
        `curl -fsS http://127.0.0.1:${signoz.candidatePort}/api/v1/health`,
      ),
    ).status,
    "ok",
  );
  const clickhouse = deployed.find((item) => item.id === "clickhouse").result;
  const collector = deployed.find((item) => item.id === "collector").result;
  const registration = target.ssh(
    `curl -fsS -H 'Content-Type: application/json' --data @- http://127.0.0.1:${signoz.candidatePort}/api/v1/register <<'JSON'
${JSON.stringify({ name: "Fixture admin", orgId: "", orgName: "Towbar fixture", email: "admin@example.test", password: adminPassword })}
JSON`,
  );
  assert(JSON.parse(registration).data.orgId);
  assert.equal(
    target.ssh(
      `curl --retry 60 --retry-all-errors --retry-delay 1 --retry-max-time 90 --max-time 3 -fsS -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' --data '{"resourceSpans":[]}' http://127.0.0.1:${collector.candidatePort}/v1/traces`,
    ),
    "200",
  );
  assert(
    Number(
      target.ssh(
        `docker exec ${clickhouse.containerName} sh -c 'clickhouse-client --user "$CLICKHOUSE_USER" --password "$CLICKHOUSE_PASSWORD" --query "SELECT histogramQuantile([1.,2.,toFloat64(1)/0],[2.,4.,6.],0.5)"'`,
      ),
    ) > 0,
  );
  assert.equal(deployed.length, 5);
  console.log(
    "Independent OCI validation passed: Keeper and collector config, collector migrations/startup check, ingestion 4318/readiness 13133, PostgreSQL, authenticated ClickHouse cluster and histogram executable, and SigNoz HTTP health on one shared private network.",
  );
} catch (error) {
  console.error(redact(error.stack ?? String(error)));
  if (error.issues) console.error(JSON.stringify(error.issues));
  // Configuration and random test credentials may appear in image diagnostics.
  for (const { id, result } of deployed)
    console.error(
      `${id}: ${redact(target.ssh(`docker logs --tail 12 ${result.containerName} 2>&1`))}`,
    );
  throw new Error("Independent OCI fixture failed; see redacted diagnostics");
} finally {
  globalThis.fetch = originalFetch;
  target.close();
}
