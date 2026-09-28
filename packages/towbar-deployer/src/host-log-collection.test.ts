import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";
import { promisify } from "node:util";
import { z } from "zod";
import { startRemoteScript } from "./app-runtime-scripts.js";

const execute = promisify(execFile);
async function harness(t: TestContext) {
  const directory = await mkdtemp(path.join(tmpdir(), "towbar-host-log-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const docker = path.join(directory, "docker");
  await copyFile(
    new URL("./test-fixtures/host-log-docker.py", import.meta.url),
    docker,
  );
  await chmod(docker, 0o755);
  const python = execFileSync("which", ["python3"], {
    encoding: "utf8",
  }).trim();
  const script = path.join(directory, "start.sh");
  await writeFile(
    script,
    startRemoteScript
      .replaceAll("/usr/bin/python3", python)
      .replaceAll("/usr/bin/docker", docker),
  );
  const root = path.join(directory, "custom-docker");
  await mkdir(path.join(root, "containers"), { recursive: true });
  const canonicalRoot = await realpath(root);
  const remote = path.join(directory, "remote");
  const secrets = path.join(remote, "secrets/runtime");
  await mkdir(secrets, { recursive: true });
  const argsFile = path.join(directory, "args.json");
  return {
    root: canonicalRoot,
    directory,
    secrets,
    async start(
      enabled = true,
      info: unknown = {
        DockerRootDir: root,
        SecurityOptions: ["name=seccomp,profile=builtin"],
      },
      foreignVolume = false,
    ) {
      await execute(
        "bash",
        [
          script,
          remote,
          "candidate",
          "collector:test",
          "2020",
          "",
          "0.25",
          "256m",
          "",
          "",
        ],
        {
          env: {
            ...process.env,
            PATH: `${directory}:${process.env.PATH}`,
            HOST_LOG_TEST_INFO: JSON.stringify(info),
            HOST_LOG_TEST_ARGS: argsFile,
            HOST_LOG_TEST_VOLUME: path.join(directory, "volume.json"),
            HOST_LOG_TEST_FOREIGN: foreignVolume ? "1" : "",
            TOWBAR_APP_ID: "app",
            TOWBAR_DEPLOYABLE_ID: "app",
            TOWBAR_SOURCE_ID: "source",
            TOWBAR_DEPLOYMENT_ID: "deployment",
            TOWBAR_COMMIT_SHA: "test",
            TOWBAR_HOST_LOG_COLLECTION: String(enabled),
            TOWBAR_VOLUME_ARGS_JSON: JSON.stringify([
              "--mount",
              "type=volume,src=towbar-app-state,dst=/var/lib/fluent-bit,volume-nocopy",
            ]),
          },
          timeout: 15_000,
        },
      );
      return z
        .array(z.string())
        .parse(JSON.parse(await readFile(argsFile, "utf8")));
    },
  };
}

void test("collector runtime resolves a custom Docker data-root and restricts its mount and privileges", async (t) => {
  const h = await harness(t);
  const args = await h.start();
  assert(
    args.includes(
      "type=volume,src=towbar-host-logs-app,dst=/var/lib/docker/containers,readonly,volume-nocopy",
    ),
  );
  assert(
    args.includes(
      "type=volume,src=towbar-app-state,dst=/var/lib/fluent-bit,volume-nocopy",
    ),
  );
  for (const [flag, value] of [
    ["--user", "0:0"],
    ["--cap-drop", "ALL"],
    ["--security-opt", "no-new-privileges"],
    ["--log-driver", "local"],
  ])
    assert.equal(args[args.indexOf(flag!) + 1], value);
  assert(args.includes("--read-only"));
  assert(args.includes("/tmp:rw,noexec,nosuid,size=16m"));
  assert(!args.join(" ").includes("docker.sock"));
  const volume = z
    .array(
      z.object({ Options: z.object({ device: z.string(), o: z.string() }) }),
    )
    .parse(
      JSON.parse(await readFile(path.join(h.directory, "volume.json"), "utf8")),
    )[0]!;
  assert.equal(volume.Options.device, `${h.root}/containers`);
  assert.equal(volume.Options.o, "bind,ro,private");
  await assert.rejects(
    h.start(true, undefined, true),
    /ownership or read-only source changed/,
  );
});

void test("runtime secrets cannot grant or revoke host-log access", async (t) => {
  const h = await harness(t);
  await writeFile(path.join(h.secrets, "TOWBAR_HOST_LOG_COLLECTION"), "true");
  assert(
    !(await h.start(false)).some((arg) => arg.includes("towbar-host-logs-")),
  );
  await writeFile(path.join(h.secrets, "TOWBAR_HOST_LOG_COLLECTION"), "false");
  assert(
    (await h.start(true)).some((arg) => arg.includes("towbar-host-logs-")),
  );
  await writeFile(
    path.join(h.secrets, "DOCKER_HOST"),
    "tcp://other-daemon:2375",
  );
  await assert.rejects(h.start(true), /cannot override Docker connection/);
});

void test("host-log runtime refuses unsafe paths and rootless or remapped Docker", async (t) => {
  const h = await harness(t);
  for (const DockerRootDir of [
    "/",
    "relative",
    `${h.root},dst=/etc`,
    `${h.root}\n`,
    null,
  ])
    await assert.rejects(
      h.start(true, { DockerRootDir }),
      /unsafe data-root|real directory/,
    );
  for (const option of ["name=rootless", "name=userns"])
    await assert.rejects(
      h.start(true, { DockerRootDir: h.root, SecurityOptions: [option] }),
      /rootful Docker/,
    );
  await rm(path.join(h.root, "containers"), { recursive: true });
  const outside = path.join(h.directory, "outside");
  await mkdir(outside);
  await symlink(outside, path.join(h.root, "containers"));
  await assert.rejects(h.start(), /real directory/);
});
