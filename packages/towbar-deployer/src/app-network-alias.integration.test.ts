import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  rollbackCandidateScript,
  startRemoteScript,
} from "./remote-scripts.js";

// Opt in on a machine with Docker. This exercises Docker DNS and real rollback.
void test(
  "App aliases keep one live owner across replacement, collision, and rollback",
  {
    skip: process.env.TOWBAR_DOCKER_TESTS !== "true",
    timeout: 60_000,
  },
  async () => {
    const id = `towbar-alias-${process.pid}-${Date.now()}`;
    const directory = mkdtempSync(path.join(tmpdir(), "towbar-alias-"));
    const names = [`${id}-old`, `${id}-new`, `${id}-collision`, `${id}-third`];
    const docker = (args: string[]) =>
      execFileSync("docker", args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    const dockerPath = execFileSync("which", ["docker"], {
      encoding: "utf8",
    }).trim();
    const pythonPath = execFileSync("which", ["python3"], {
      encoding: "utf8",
    }).trim();
    const image = `${id}:test`;
    const startScript = path.join(directory, "start.sh");
    const rollbackScript = path.join(directory, "rollback.sh");
    writeFileSync(
      startScript,
      startRemoteScript
        .replaceAll("/var/lib/towbar/locks", path.join(directory, "locks"))
        .replaceAll("sudo install", "install")
        .replaceAll("/usr/bin/docker", dockerPath)
        .replaceAll("/usr/bin/python3", pythonPath),
    );
    writeFileSync(rollbackScript, rollbackCandidateScript);
    const env = {
      ...process.env,
      TOWBAR_APP_ID: id,
      TOWBAR_DEPLOYABLE_ID: id,
      TOWBAR_SOURCE_ID: id,
      TOWBAR_DEPLOYMENT_ID: id,
    };
    const start = (name: string, previous: string, commit: string) => {
      const remote = path.join(directory, name);
      mkdirSync(path.join(remote, "secrets/runtime"), { recursive: true });
      try {
        return execFileSync(
          "bash",
          [
            startScript,
            remote,
            name,
            image,
            "8080",
            id,
            "",
            "",
            "api",
            previous,
          ],
          {
            env: { ...env, TOWBAR_COMMIT_SHA: commit },
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
          },
        ).trim();
      } catch (error) {
        let diagnostic = "";
        try {
          diagnostic =
            docker([
              "inspect",
              "--format",
              "{{json .State}} {{json .HostConfig.PortBindings}}",
              name,
            ]) + docker(["logs", name]);
        } catch {
          /* Candidate may not exist. */
        }
        throw new Error(`${String(error)} ${diagnostic}`, { cause: error });
      }
    };
    const running = (name: string) =>
      docker(["inspect", "--format", "{{.State.Running}}", name]) === "true";
    const resolve = () =>
      docker([
        "run",
        "--rm",
        "--network",
        id,
        "alpine:3.23",
        "wget",
        "-qO-",
        "http://api:8080",
      ]);
    const expectResponse = async (value: string) => {
      for (let attempt = 0; attempt < 15; attempt++) {
        try {
          assert.equal(resolve(), value);
          return;
        } catch (error) {
          if (attempt === 14) throw error;
          await new Promise((done) => setTimeout(done, 100));
        }
      }
    };
    try {
      docker(["network", "create", id]);
      const command =
        "while true; do printf 'HTTP/1.1 200 OK\\r\\nConnection: close\\r\\n\\r\\n%s\\n' \"$SOURCE_COMMIT\" | nc -l -p 8080; done";
      writeFileSync(
        path.join(directory, "Dockerfile"),
        `FROM alpine:3.23\nCMD ${JSON.stringify(["sh", "-c", command])}\n`,
      );
      docker(["build", "-q", "-t", image, directory]);
      start(names[0]!, "", "old");
      await expectResponse("old");
      start(names[1]!, names[0]!, "new");
      assert.equal(running(names[0]!), false);
      assert.equal(running(names[1]!), true);
      await expectResponse("new");
      assert.throws(
        () => start(names[2]!, names[0]!, "collision"),
        /already used/u,
      );
      assert.equal(running(names[1]!), true);
      execFileSync(
        "bash",
        [
          rollbackScript,
          path.join(directory, names[1]!),
          id,
          names[1]!,
          image,
          "false",
          names[0]!,
          id,
        ],
        { encoding: "utf8" },
      );
      assert.equal(running(names[0]!), true);
      await expectResponse("old");
      // Simulate a successful promotion whose old-container cleanup was deferred.
      start(names[1]!, names[0]!, "new");
      start(names[3]!, names[1]!, "third");
      assert.throws(() => docker(["inspect", names[0]!]));
      assert.equal(running(names[1]!), false);
      await expectResponse("third");
    } finally {
      for (const name of names) {
        try {
          docker(["rm", "-f", name]);
        } catch {
          /* Candidate may not exist. */
        }
      }
      try {
        docker(["network", "rm", id]);
      } finally {
        try {
          docker(["image", "rm", image]);
        } finally {
          rmSync(directory, { recursive: true, force: true });
        }
      }
    }
  },
);
