import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const docker = (args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

export async function startTestTarget({ systemd = false } = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "towbar-v2-target-"));
  const name = `towbar-v2-target-${process.pid}-${Date.now()}`;
  const key = path.join(directory, "identity");
  let container;
  const close = () => {
    try {
      if (container) docker(["rm", "-f", "-v", container]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  };
  try {
    execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", key]);
    execFileSync(
      "docker",
      [
        "build",
        "-t",
        "towbar-v2-e2e-target:local",
        "-f",
        "tools/e2e/target.Dockerfile",
        ".",
      ],
      { cwd: repository, stdio: "pipe" },
    );
    container = docker([
      "create",
      "--privileged",
      ...(systemd
        ? [
            "--cgroupns=private",
            "--tmpfs",
            "/run",
            "--tmpfs",
            "/run/lock",
            "-e",
            "TOWBAR_TEST_SYSTEMD=1",
          ]
        : []),
      "--name",
      name,
      "--label",
      "towbar.test=v2-e2e",
      "-e",
      "DOCKER_TLS_CERTDIR=",
      "-p",
      "127.0.0.1::22",
      "towbar-v2-e2e-target:local",
    ]);
    docker(["cp", `${key}.pub`, `${container}:/test-key.pub`]);
    docker(["start", container]);
    const port = Number(
      docker([
        "inspect",
        "--format",
        '{{(index (index .NetworkSettings.Ports "22/tcp") 0).HostPort}}',
        container,
      ]),
    );
    const ssh = (command) =>
      execFileSync(
        "ssh",
        [
          "-i",
          key,
          "-p",
          String(port),
          "-o",
          "BatchMode=yes",
          "-o",
          "IdentitiesOnly=yes",
          "-o",
          "ConnectTimeout=2",
          "-o",
          "StrictHostKeyChecking=accept-new",
          "-o",
          `UserKnownHostsFile=${directory}/known_hosts`,
          "deploy@127.0.0.1",
          command,
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      ).trim();
    const deadline = Date.now() + 60_000;
    let lastError;
    while (Date.now() < deadline) {
      try {
        ssh("docker info --format '{{.ID}}'");
        if (systemd)
          ssh("sudo systemctl is-active caddy ssh towbar-test-docker");
        return { container, directory, key, port, ssh, close };
      } catch (error) {
        lastError = error;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error("Isolated SSH/Docker target did not become ready", {
      cause: lastError,
    });
  } catch (error) {
    close();
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = await startTestTarget();
  try {
    if (target.ssh("id -u") === "0")
      throw new Error("SSH must use the non-root deploy user");
    target.ssh(
      "test -x /usr/bin/docker && test -x /usr/bin/python3 && bash --version >/dev/null",
    );
    const outer = docker(["info", "--format", "{{.ID}}"]);
    const inner = target.ssh("docker info --format '{{.ID}}'");
    if (!inner || outer === inner)
      throw new Error("Test target must have an isolated Docker daemon");
    console.log("Non-root SSH and isolated Linux Docker daemon verified.");
  } finally {
    target.close();
  }
}
