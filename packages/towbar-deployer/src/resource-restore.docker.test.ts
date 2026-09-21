import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promoteCandidateScript } from "./resource-restore-scripts.js";

void test(
  "resource restore promotion preserves instance ownership and sibling environment data",
  {
    skip: process.env.TOWBAR_DOCKER_TESTS !== "true",
    timeout: 120_000,
  },
  async () => {
    const id = `towbar-restore-${process.pid}-${Date.now()}`;
    const productionId = `${id}-production`,
      stagingId = `${id}-staging`;
    const current = `${id}-current`,
      candidate = `${id}-candidate`,
      staging = `${id}-sibling`;
    const previousVolume = `${productionId}-data`,
      candidateVolume = `${productionId}-restored`,
      stagingVolume = `${stagingId}-data`;
    const directory = mkdtempSync(
      path.join(tmpdir(), "towbar-restore-docker-"),
    );
    const docker = (args: string[]) =>
      execFileSync("docker", args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    const image = "redis:8-alpine";
    const password = "local-test-only";
    const cli = (container: string, args: string[]) =>
      docker([
        "exec",
        container,
        "redis-cli",
        "--no-auth-warning",
        "-a",
        password,
        ...args,
      ]);
    const start = async (container: string, volume: string, owner: string) => {
      docker([
        "volume",
        "create",
        "--label",
        "towbar.managed=true",
        "--label",
        `towbar.deployable=${owner}`,
        volume,
      ]);
      docker([
        "run",
        "-d",
        "--name",
        container,
        "--label",
        "towbar.managed=true",
        "--label",
        `towbar.deployable=${owner}`,
        "--label",
        `towbar.app=${owner}`,
        "--mount",
        `type=volume,src=${volume},dst=/data`,
        image,
        "redis-server",
        "--requirepass",
        password,
      ]);
      for (let i = 0; i < 40; i++) {
        try {
          if (cli(container, ["PING"]) === "PONG") return;
        } catch {
          /* Redis is starting. */
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.fail(`Redis did not start: ${container}`);
    };
    try {
      docker(["pull", image]);
      await start(current, previousVolume, productionId);
      await start(staging, stagingVolume, stagingId);
      await start(candidate, candidateVolume, productionId);
      for (const [container, value] of [
        [current, "production-before"],
        [staging, "staging-untouched"],
        [candidate, "production-restored"],
      ]) {
        cli(container!, ["SET", "environment", value!]);
        cli(container!, ["SAVE"]);
      }
      const runtime = path.join(directory, "runtime");
      mkdirSync(runtime);
      writeFileSync(path.join(runtime, "REDIS_PASSWORD"), password);
      const pointer = path.join(directory, "data.active");
      writeFileSync(pointer, previousVolume);
      const script = path.join(directory, "promote.sh");
      writeFileSync(
        script,
        promoteCandidateScript
          .replaceAll(
            "/usr/bin/docker",
            execFileSync("which", ["docker"], { encoding: "utf8" }).trim(),
          )
          .replaceAll(
            "/usr/bin/python3",
            execFileSync("which", ["python3"], { encoding: "utf8" }).trim(),
          ),
      );
      const output = execFileSync(
        "bash",
        [
          script,
          "redis",
          current,
          candidate,
          candidateVolume,
          previousVolume,
          pointer,
          "/data",
          image,
          "",
          "",
          "",
          "6379",
          "0.5",
          "128m",
          runtime,
          productionId,
          "database",
          id,
          "release-id",
          "restore",
          "redis-server",
          "--requirepass",
          password,
        ],
        { encoding: "utf8" },
      );
      assert.match(output, /PROMOTED/);
      assert.equal(readFileSync(pointer, "utf8").trim(), candidateVolume);
      assert.equal(
        docker(["volume", "inspect", "--format", "{{.Name}}", previousVolume]),
        previousVolume,
      );
      assert.equal(cli(current, ["GET", "environment"]), "production-restored");
      assert.equal(cli(staging, ["GET", "environment"]), "staging-untouched");
      for (const label of [
        "towbar.app",
        "towbar.deployable",
        "towbar.resource",
      ]) {
        assert.equal(
          docker([
            "inspect",
            "--format",
            `{{index .Config.Labels "${label}"}}`,
            current,
          ]),
          productionId,
        );
      }
      assert.equal(
        docker([
          "inspect",
          "--format",
          '{{index .Config.Labels "towbar.deployable"}}',
          staging,
        ]),
        stagingId,
      );
    } finally {
      for (const container of [current, candidate, staging]) {
        try {
          docker(["rm", "-f", container]);
        } catch {
          /* Setup may have failed before creation. */
        }
      }
      for (const volume of [previousVolume, candidateVolume, stagingVolume]) {
        try {
          docker(["volume", "rm", volume]);
        } catch {
          /* Setup may have failed before creation. */
        }
      }
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
