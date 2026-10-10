import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { normalizeDeploymentManifest } from "@workspace/towbar-core";
import { restoreCandidateScript } from "./resource-restore-scripts.js";

const postgres18Image =
  "postgres:18-alpine@sha256:d3e1620b530c944afa6e887d22eb899824da68e19c52024bf98f5220c88a65b2";

for (const major of [17, 18]) {
  void test(
    `PostgreSQL ${major} datastore persists across recreation and restores into its versioned layout`,
    { skip: process.env.TOWBAR_DOCKER_TESTS !== "true", timeout: 300_000 },
    async () => {
      const resource = normalizeDeploymentManifest({
        version: 2,
        apps: [],
        resources: [
          {
            id: "database",
            name: "Database",
            type: "postgres",
            server: "192.0.2.10",
            ...(major === 18 ? { image: postgres18Image } : {}),
          },
        ],
      }).resources![0]!;
      assert.equal(resource.health.type, "command");
      const healthCommand =
        resource.health.type === "command" ? resource.health.command : [];
      const mountPath = resource.container.volumes[0]!.mountPath;
      const id = `towbar-postgres-${major}-${process.pid}-${Date.now()}`;
      const current = `${id}-current`;
      const candidate = `${id}-candidate`;
      const incompatible = `${id}-incompatible`;
      const volume = `${id}-data`;
      const restoredVolume = `${id}-restored`;
      const directory = mkdtempSync(path.join(tmpdir(), "towbar-postgres-"));
      const docker = (args: string[]) =>
        execFileSync("docker", args, {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 120_000,
        }).trim();
      const logs = (container: string) => {
        const result = spawnSync("docker", ["logs", container], {
          encoding: "utf8",
          timeout: 30_000,
        });
        assert.equal(result.status, 0, result.stderr);
        return `${result.stdout}${result.stderr}`;
      };
      const query = (container: string, sql: string) =>
        docker([
          "exec",
          "--env",
          "PGPASSWORD=local-test-only",
          container,
          "psql",
          "-h",
          "127.0.0.1",
          "-U",
          "postgres",
          "-d",
          "towbar",
          "-v",
          "ON_ERROR_STOP=1",
          "-Atqc",
          sql,
        ]);
      const ready = async (container: string) => {
        for (let attempt = 0; attempt < 120; attempt++) {
          try {
            docker(["exec", container, ...healthCommand]);
            if (query(container, "SELECT 1") === "1") return;
          } catch {
            // Initialization may still be creating the database.
          }
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        assert.fail(`PostgreSQL did not start: ${logs(container)}`);
      };
      const start = () =>
        docker([
          "run",
          "-d",
          "--name",
          current,
          "--mount",
          `type=volume,src=${volume},dst=${mountPath}`,
          "--env",
          "POSTGRES_DB=towbar",
          "--env",
          "POSTGRES_PASSWORD=local-test-only",
          resource.image,
        ]);
      try {
        docker(["pull", resource.image]);
        docker(["volume", "create", volume]);
        docker(["volume", "create", restoredVolume]);
        start();
        await ready(current);
        assert.equal(
          query(current, "SHOW server_version_num").slice(0, 2),
          String(major),
        );
        assert.equal(
          query(current, "SHOW data_directory"),
          major === 18
            ? "/var/lib/postgresql/18/docker"
            : "/var/lib/postgresql/data",
        );
        query(
          current,
          "CREATE TABLE saved_data (value text NOT NULL); INSERT INTO saved_data VALUES ('persisted-before-backup');",
        );
        docker(["rm", "-f", current]);
        start();
        await ready(current);
        assert.equal(
          query(current, "SELECT value FROM saved_data"),
          "persisted-before-backup",
        );

        const backup = path.join(directory, "database.dump");
        writeFileSync(
          backup,
          execFileSync(
            "docker",
            [
              "exec",
              current,
              "pg_dump",
              "-U",
              "postgres",
              "-d",
              "towbar",
              "--format=custom",
              "--no-owner",
              "--no-privileges",
            ],
            { timeout: 30_000 },
          ),
        );
        query(current, "UPDATE saved_data SET value = 'changed-after-backup'");
        const runtime = path.join(directory, "runtime");
        mkdirSync(runtime);
        writeFileSync(path.join(runtime, "POSTGRES_DB"), "towbar");
        writeFileSync(
          path.join(runtime, "POSTGRES_PASSWORD"),
          "local-test-only",
        );
        const script = path.join(directory, "restore.sh");
        writeFileSync(
          script,
          restoreCandidateScript
            .replaceAll(
              "/usr/bin/docker",
              execFileSync("which", ["docker"], { encoding: "utf8" }).trim(),
            )
            .replaceAll(
              "/usr/bin/python3",
              execFileSync("which", ["python3"], { encoding: "utf8" }).trim(),
            ),
        );
        execFileSync(
          "bash",
          [
            script,
            "postgres",
            candidate,
            restoredVolume,
            mountPath,
            backup,
            resource.image,
            "1",
            "512m",
            runtime,
          ],
          { timeout: 150_000, stdio: ["ignore", "pipe", "pipe"] },
        );
        assert.equal(
          query(candidate, "SELECT value FROM saved_data"),
          "persisted-before-backup",
        );
        assert.equal(
          query(current, "SELECT value FROM saved_data"),
          "changed-after-backup",
        );

        if (major === 17) {
          docker(["pull", postgres18Image]);
          docker(["rm", "-f", current]);
          docker([
            "run",
            "-d",
            "--name",
            incompatible,
            "--mount",
            `type=volume,src=${volume},dst=/var/lib/postgresql`,
            "--env",
            "POSTGRES_PASSWORD=local-test-only",
            postgres18Image,
          ]);
          assert.equal(docker(["wait", incompatible]), "1");
          assert.match(
            logs(incompatible),
            /there appears to be PostgreSQL data in/u,
          );
          start();
          await ready(current);
          assert.equal(
            query(current, "SELECT value FROM saved_data"),
            "changed-after-backup",
          );
        }
      } finally {
        for (const container of [current, candidate, incompatible]) {
          try {
            docker(["rm", "-f", container]);
          } catch {
            /* Container may not have been created. */
          }
        }
        for (const name of [volume, restoredVolume]) {
          try {
            docker(["volume", "rm", name]);
          } catch {
            /* Volume may not have been created. */
          }
        }
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
}
