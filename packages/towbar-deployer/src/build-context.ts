import { realpath, stat } from "node:fs/promises";
import path from "node:path";

import { runCommand } from "./process.js";

export async function createBuildContextArchive(input: {
  archivePath: string;
  checkout: string;
  contextPath: string;
  dockerfilePath: string;
  signal?: AbortSignal;
}) {
  const checkoutRoot = await realpath(input.checkout);
  const contextCandidate = path.resolve(checkoutRoot, input.contextPath);
  const contextRoot = await realpath(contextCandidate);

  assertContainedPath(checkoutRoot, contextRoot, "Build context");
  if (contextCandidate !== contextRoot) {
    throw new Error("Build context cannot traverse symbolic links");
  }
  if (!(await stat(contextRoot)).isDirectory()) {
    throw new Error("Build context must be a directory");
  }

  const dockerfileCandidate = path.resolve(checkoutRoot, input.dockerfilePath);
  const dockerfile = await realpath(dockerfileCandidate);
  assertContainedPath(contextRoot, dockerfile, "Dockerfile");
  if (dockerfileCandidate !== dockerfile) {
    throw new Error("Dockerfile cannot traverse symbolic links");
  }
  if (!(await stat(dockerfile)).isFile()) {
    throw new Error("Dockerfile must be a regular file");
  }

  await runCommand("tar", ["-czf", input.archivePath, "."], {
    cwd: contextRoot,
    signal: input.signal,
    timeoutMs: 180_000,
  });

  return {
    relativeDockerfile: path.relative(contextRoot, dockerfile),
  };
}

function assertContainedPath(root: string, candidate: string, label: string) {
  if (candidate === root || candidate.startsWith(`${root}${path.sep}`)) return;
  throw new Error(`${label} escaped the checkout`);
}
