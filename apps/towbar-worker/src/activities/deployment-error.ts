import { CommandError } from "@workspace/towbar-deployer";

export function deploymentErrorMessage(error: unknown, state?: string) {
  if (error instanceof CommandError) {
    if (
      state === "starting_candidate" &&
      /Host log collection could not inspect Docker's data-root/u.test(
        error.stderr,
      )
    )
      return "Host log collection could not inspect Docker's data-root. Check the deploy user's passwordless sudo access for the Docker log directory.";
    if (/^ssh exited unsuccessfully$/iu.test(error.message)) {
      if (/permission denied \(publickey(?:,[^)]+)?\)/iu.test(error.stderr))
        return "Towbar could not sign in to the server over SSH. Check that the selected private key is authorized for the configured SSH username.";
      if (
        /ssh: connect to host[^\r\n]+: (?:connection|operation) timed out/iu.test(
          error.stderr,
        )
      )
        return "The SSH connection timed out. Check the server address, SSH port, and firewall rules.";
      if (
        /ssh: connect to host[^\r\n]+: connection refused/iu.test(error.stderr)
      )
        return "The server refused the SSH connection. Check the SSH port and that the SSH service is running.";
      if (
        /ssh: (?:connect to host[^\r\n]+: no route to host|could not resolve hostname)/iu.test(
          error.stderr,
        )
      )
        return "Towbar could not reach the server over SSH. Check its address, network, and firewall rules.";
      if (/host key verification failed/iu.test(error.stderr))
        return "The server's SSH identity could not be verified. Review its trusted host keys in Towbar before trying again.";
    }
    const step = state ? ` during ${state.replaceAll("_", " ")}` : "";
    return `A deployment command failed${step}. Open the deployment logs to see the cause before trying again.`;
  }
  if (!(error instanceof Error)) return "Deployment failed";
  return error.message
    .replace(/Bearer\s+\S+/giu, "Bearer [REDACTED]")
    .slice(0, 1_000);
}
