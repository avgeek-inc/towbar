import type { SshSession } from "./ssh.js";

const imageProvenanceScript = String.raw`set -euo pipefail
docker image inspect --format '{{.Id}} {{.Os}}/{{.Architecture}}' "$1"
`;

export type ImageProvenance = {
  imageDigest: string;
  imagePlatform: string;
};

export async function inspectImageProvenance(input: {
  imageTag: string;
  session: SshSession;
  signal?: AbortSignal;
}): Promise<ImageProvenance> {
  const { stdout } = await input.session.run(
    imageProvenanceScript,
    [input.imageTag],
    { signal: input.signal, timeoutMs: 30_000 },
  );
  return parseImageProvenance(stdout);
}

export function parseImageProvenance(output: string): ImageProvenance {
  const [imageDigest, imagePlatform, ...unexpected] = output
    .trim()
    .split(/\s+/u);
  if (
    unexpected.length > 0 ||
    !imageDigest ||
    !/^sha256:[a-f0-9]{64}$/u.test(imageDigest) ||
    !imagePlatform ||
    !/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/u.test(imagePlatform)
  ) {
    throw new Error("Docker returned invalid image provenance");
  }
  return { imageDigest, imagePlatform };
}
