export function parseCandidatePort(
  output: string,
  requiresPublishedPort: boolean,
) {
  const candidatePort = Number(output.trim().split("\n").at(-1));
  if (
    !Number.isInteger(candidatePort) ||
    candidatePort < 0 ||
    (requiresPublishedPort && candidatePort < 1)
  ) {
    throw new Error("Docker did not report a candidate port");
  }
  return candidatePort;
}
