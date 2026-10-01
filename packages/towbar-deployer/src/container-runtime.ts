import { writeFile } from "node:fs/promises";
import path from "node:path";
import { configurationMountArguments } from "./configuration-files.js";
import type { DeploymentExecutionContext } from "./types.js";
import type { NormalizedDeploymentHook } from "@workspace/towbar-core";
import type { SshSession } from "./ssh.js";

export function containerRuntimeOptions(
  context: DeploymentExecutionContext,
  hook?: NormalizedDeploymentHook,
) {
  const container = context.app.container;
  const health = context.app.health;
  const options = hook ?? container;
  return JSON.stringify({
    configMounts: configurationMountArguments(context),
    ...("entrypoint" in options && options.entrypoint !== undefined
      ? { entrypoint: options.entrypoint }
      : {}),
    ...("command" in options ? { command: options.command } : {}),
    ...(!hook && health.type === "command"
      ? { healthCommand: health.command }
      : {}),
    ...(!hook &&
    "port" in health &&
    health.port &&
    health.port !== ("port" in container ? container.port : undefined)
      ? { healthPort: health.port }
      : {}),
  });
}

export function containerRuntimeOptionsPath(
  directory: string,
  hookName?: "preDeploy" | "postDeploy",
) {
  return path.posix.join(
    directory,
    `container-runtime${hookName ? `-${hookName}` : ""}.json`,
  );
}

export async function prepareContainerRuntimeOptions(input: {
  context: DeploymentExecutionContext;
  hook?: NormalizedDeploymentHook;
  hookName?: "preDeploy" | "postDeploy";
  localDirectory: string;
  remoteDirectory: string;
  session: SshSession;
  signal?: AbortSignal;
}) {
  const localPath = containerRuntimeOptionsPath(
    input.localDirectory,
    input.hookName,
  );
  await writeFile(
    localPath,
    containerRuntimeOptions(input.context, input.hook),
    {
      mode: 0o600,
    },
  );
  await input.session.upload(
    localPath,
    containerRuntimeOptionsPath(input.remoteDirectory, input.hookName),
    { signal: input.signal },
  );
}

export const containerRuntimeArgumentsScript = String.raw`
runtime_file = os.environ.get("TOWBAR_CONTAINER_RUNTIME_FILE")
options = json.loads(Path(runtime_file).read_text()) if runtime_file else {}
runtime_arguments.extend(options.get("configMounts", []))
if "entrypoint" in options:
    runtime_arguments.extend(["--entrypoint", options["entrypoint"]])
if options.get("healthPort"):
    runtime_arguments.extend(["--publish", f"127.0.0.1::{options['healthPort']}"])
command.extend(options.get("command") or [])
`;
