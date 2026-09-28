import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as wait } from "node:timers/promises";
import { promisify } from "node:util";
import { z } from "zod";
import { normalizeDeploymentManifest } from "@workspace/towbar-core";
import { appVolumeMounts, prepareAppStorageScript } from "./app-storage.js";
import { startRemoteScript } from "./app-runtime-scripts.js";
import { healthRemoteScript } from "./remote-scripts.js";

const execute = promisify(execFile);
void test(
  "host logs are read-only under a custom Docker data-root, collector logs are excluded and state survives replacement",
  { skip: process.env.TOWBAR_DOCKER_TESTS !== "true", timeout: 240_000 },
  async () => {
    const id = randomUUID(),
      source = randomUUID();
    const target = `towbar-host-logs-test-${id}`;
    const directory = await mkdtemp(
      path.join(tmpdir(), "towbar-host-logs-docker-"),
    );
    const docker = async (...args: string[]) =>
      (
        await execute("docker", args, {
          encoding: "utf8",
          timeout: 120_000,
          maxBuffer: 4 * 1024 * 1024,
        })
      ).stdout.trim();
    const remote = (...args: string[]) => docker("exec", target, ...args);
    const app = normalizeDeploymentManifest({
      version: 2,
      source: { branch: "main" },
      apps: [
        {
          id: "host-logs",
          name: "Host logs",
          server: "192.0.2.10",
          dockerfile: "Dockerfile",
          rollout: {
            type: "recreate",
            maintenanceMode: true,
            reason: "One buffer writer",
          },
          container: {
            port: 2020,
            hostLogs: { dockerJsonFiles: true },
            resources: { cpus: 0.25, memory: "256m" },
            volumes: [{ name: "state", mountPath: "/var/lib/fluent-bit" }],
          },
        },
      ],
    }).apps[0]!;
    const shell = (script: string, args: string[]) =>
      remote(
        "env",
        `TOWBAR_APP_ID=${id}`,
        `TOWBAR_DEPLOYABLE_ID=${id}`,
        `TOWBAR_SOURCE_ID=${source}`,
        `TOWBAR_DEPLOYMENT_ID=${id}`,
        "TOWBAR_COMMIT_SHA=test",
        "TOWBAR_HOST_LOG_COLLECTION=true",
        `TOWBAR_VOLUME_ARGS_JSON=${JSON.stringify(appVolumeMounts(app, id))}`,
        "bash",
        "-c",
        script,
        "test",
        ...args,
      );
    const start = async (name: string, previous = "") => {
      await shell(prepareAppStorageScript, [
        id,
        id,
        source,
        id,
        "collector:test",
        previous,
        JSON.stringify(app.container.volumes),
      ]);
      const port = await shell(startRemoteScript, [
        "/test",
        name,
        "collector:test",
        "2020",
        "",
        "0.25",
        "256m",
        "",
        previous,
      ]);
      await shell(healthRemoteScript, [port, "/api/v1/health", "15"]);
    };
    try {
      await docker(
        "run",
        "-d",
        "--privileged",
        "--mount",
        "type=volume,dst=/srv/docker-custom",
        "--name",
        target,
        "--label",
        `towbar.verification.run=${process.env.TOWBAR_VERIFICATION_RUN_ID ?? id}`,
        "--entrypoint",
        "/usr/local/bin/dind",
        "towbar-v2-e2e-target:local",
        "dockerd",
        "--host=unix:///var/run/docker.sock",
        "--data-root=/srv/docker-custom",
      );
      let ready = false;
      for (let attempt = 0; attempt < 60; attempt++) {
        try {
          await remote("docker", "info");
          ready = true;
          break;
        } catch {
          await wait(500);
        }
      }
      assert(ready, "Disposable Linux Docker target did not become ready");
      await remote("mkdir", "-p", "/test/secrets/runtime");
      const dockerfile = path.join(directory, "Dockerfile");
      await writeFile(
        dockerfile,
        'FROM alpine:3.22\nRUN apk add --no-cache busybox-extras && mkdir -p /var/lib/fluent-bit /www/api/v1 && echo ok > /www/api/v1/health\nUSER 1000:1000\nCMD ["httpd", "-f", "-p", "2020", "-h", "/www"]\n',
      );
      await docker("cp", dockerfile, `${target}:/test/Dockerfile`);
      await remote("docker", "build", "-q", "-t", "collector:test", "/test");
      const producer = await remote(
        "docker",
        "run",
        "-d",
        "--log-driver",
        "json-file",
        "alpine:3.22",
        "sh",
        "-c",
        "echo source-log-marker; sleep 300",
      );
      await start("collector-first");
      const inspect = z.object({
        Config: z.object({ User: z.string() }),
        HostConfig: z.object({
          CapDrop: z.array(z.string()),
          ReadonlyRootfs: z.boolean(),
          SecurityOpt: z.array(z.string()),
          LogConfig: z.object({ Type: z.string() }),
        }),
        Mounts: z.array(
          z.object({
            Type: z.string(),
            Source: z.string(),
            Destination: z.string(),
            RW: z.boolean(),
          }),
        ),
      });
      const first = inspect.parse(
        JSON.parse(await remote("docker", "inspect", "collector-first"))[0],
      );
      assert.deepEqual(
        first.Mounts.find(
          (mount) => mount.Destination === "/var/lib/docker/containers",
        ),
        {
          Type: "volume",
          Source: `/srv/docker-custom/volumes/towbar-host-logs-${id}/_data`,
          Destination: "/var/lib/docker/containers",
          RW: false,
        },
      );
      assert.equal(
        await remote(
          "docker",
          "volume",
          "inspect",
          "--format",
          "{{.Options.device}}",
          `towbar-host-logs-${id}`,
        ),
        "/srv/docker-custom/containers",
      );
      assert.equal(
        await remote(
          "docker",
          "volume",
          "inspect",
          "--format",
          "{{.Options.o}}",
          `towbar-host-logs-${id}`,
        ),
        "bind,ro,private",
      );
      await remote(
        "mkdir",
        "-p",
        "/srv/docker-custom/containers/test-submount",
      );
      await remote(
        "mount",
        "-t",
        "tmpfs",
        "tmpfs",
        "/srv/docker-custom/containers/test-submount",
      );
      await remote(
        "sh",
        "-c",
        "echo private-host-file > /srv/docker-custom/containers/test-submount/marker",
      );
      await assert.rejects(
        remote(
          "docker",
          "exec",
          "collector-first",
          "test",
          "-e",
          "/var/lib/docker/containers/test-submount/marker",
        ),
      );
      assert.equal(first.Config.User, "0:0");
      assert.deepEqual(first.HostConfig.CapDrop, ["ALL"]);
      assert(first.HostConfig.ReadonlyRootfs);
      assert(first.HostConfig.SecurityOpt.includes("no-new-privileges"));
      assert.equal(first.HostConfig.LogConfig.Type, "local");
      const log = `/var/lib/docker/containers/${producer}/${producer}-json.log`;
      assert.match(
        await remote("docker", "exec", "collector-first", "cat", log),
        /source-log-marker/,
      );
      await assert.rejects(
        remote(
          "docker",
          "exec",
          "collector-first",
          "sh",
          "-c",
          `echo modified >> ${log}`,
        ),
        /Read-only file system/,
      );
      await assert.rejects(
        remote(
          "docker",
          "exec",
          "collector-first",
          "test",
          "-e",
          "/var/run/docker.sock",
        ),
      );
      await remote(
        "docker",
        "exec",
        "collector-first",
        "sh",
        "-c",
        "echo cursor-marker > /var/lib/fluent-bit/cursor.db; echo chunk-marker > /var/lib/fluent-bit/buffer.chunk",
      );
      await remote("docker", "restart", "collector-first");
      await start("collector-second", "collector-first");
      await assert.rejects(
        remote(
          "docker",
          "exec",
          "collector-second",
          "test",
          "-e",
          "/var/lib/docker/containers/test-submount/marker",
        ),
      );
      assert.equal(
        await remote(
          "docker",
          "inspect",
          "--format",
          "{{.State.Running}}",
          "collector-first",
        ),
        "false",
      );
      assert.equal(
        await remote(
          "docker",
          "exec",
          "collector-second",
          "cat",
          "/var/lib/fluent-bit/cursor.db",
        ),
        "cursor-marker",
      );
      assert.equal(
        await remote(
          "docker",
          "exec",
          "collector-second",
          "cat",
          "/var/lib/fluent-bit/buffer.chunk",
        ),
        "chunk-marker",
      );
      const collectorId = await remote(
        "docker",
        "inspect",
        "--format",
        "{{.Id}}",
        "collector-second",
      );
      await assert.rejects(
        remote(
          "test",
          "-e",
          `/srv/docker-custom/containers/${collectorId}/${collectorId}-json.log`,
        ),
      );
    } finally {
      await docker("rm", "-f", "-v", target);
      await rm(directory, { recursive: true, force: true });
    }
  },
);
