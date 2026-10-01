import { configurationMountArguments } from "./configuration-files.js";
import type { DeploymentExecutionContext } from "./types.js";
import type { NormalizedDeploymentHook } from "@workspace/towbar-core";

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
    ...(!hook && "command" in container ? { command: container.command } : {}),
    ...(!hook &&
    "port" in health &&
    health.port &&
    health.port !== ("port" in container ? container.port : undefined)
      ? { healthPort: health.port }
      : {}),
  });
}

export const containerRuntimeArgumentsScript = String.raw`
options = json.loads(os.environ.get("TOWBAR_CONTAINER_RUNTIME_JSON", "{}"))
runtime_arguments.extend(options.get("configMounts", []))
if "entrypoint" in options:
    runtime_arguments.extend(["--entrypoint", options["entrypoint"]])
if options.get("healthPort"):
    runtime_arguments.extend(["--publish", f"127.0.0.1::{options['healthPort']}"])
`;
