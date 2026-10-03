import { SshSession } from "./ssh.js";
import type { DeploymentExecutionContext, DeploymentSecrets } from "./types.js";

// Only Towbar-generated, one-host-per-block fragments are accepted. The receipt
// survives an interrupted deployment, and rollback refuses concurrent edits.
export const domainRoutingPython = String.raw`
import json, pathlib, re, sys
root = pathlib.Path("/etc/caddy/towbar")
stage = pathlib.Path(sys.argv[1]) / "domain-handoffs"
mode = sys.argv[2]

def filtered(text, hostnames):
    lines = text.splitlines(keepends=True)
    result = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if not line.strip():
            result.append(line); i += 1; continue
        header = re.fullmatch(r"([^\s{}]+) \{\s*", line)
        if not header:
            raise RuntimeError("Unexpected non-generated Towbar route")
        start = i
        i += 1
        while i < len(lines) and lines[i].strip("\r\n") != "}":
            i += 1
        if i == len(lines):
            raise RuntimeError("Incomplete Towbar route")
        i += 1
        host = header.group(1).removeprefix("http://").removeprefix("https://").lower().rstrip(".")
        if host not in hostnames:
            result.extend(lines[start:i])
    return "".join(result)

if mode == "apply":
    groups = {}
    for transfer in json.loads(sys.argv[3]):
        owner = transfer["previousAppId"]
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,62}", owner):
            raise RuntimeError("Invalid previous runtime identity")
        groups.setdefault(owner, set()).add(transfer["hostname"].lower().rstrip("."))
    stage.mkdir(mode=0o700, parents=True, exist_ok=True)
    for owner, hostnames in groups.items():
        route = root / (owner + ".caddy")
        if not route.exists():
            continue
        before = stage / (owner + ".before")
        after = stage / (owner + ".after")
        if before.exists():
            if route.read_bytes() == before.read_bytes():
                route.write_bytes(after.read_bytes())
                continue
            if route.read_bytes() != after.read_bytes():
                raise RuntimeError("Previous domain route changed during handoff")
            continue
        text = route.read_text()
        changed = filtered(text, hostnames)
        before.write_text(text)
        after.write_text(changed)
        route.write_text(changed)
elif mode == "rollback" and stage.exists():
    for before in sorted(stage.glob("*.before")):
        route = root / (before.stem + ".caddy")
        after = stage / (before.stem + ".after")
        if route.exists() and route.read_bytes() == before.read_bytes():
            continue
        if not route.exists() or route.read_bytes() != after.read_bytes():
            raise RuntimeError("Previous domain route changed after handoff; refusing to overwrite it")
        route.write_bytes(before.read_bytes())
`;

export function localDomainHandoffs(context: DeploymentExecutionContext) {
  return (context.domainHandoffs ?? []).filter(
    (handoff) => handoff.previousServerId === context.serverId,
  );
}

export async function cleanupTransferredDomainRoutes(
  context: DeploymentExecutionContext,
  secrets: DeploymentSecrets,
) {
  for (const origin of context.domainHandoffServers ?? []) {
    const handoffs = (context.domainHandoffs ?? []).filter(
      (handoff) => handoff.previousServerId === origin.id,
    );
    if (!handoffs.length) continue;
    const login = secrets.domainHandoffLogins?.[origin.id];
    if (!login)
      throw new Error(
        "Previous domain owner's SSH credentials are unavailable",
      );
    const session = await SshSession.connect({
      login,
      server: origin.server,
      trustedHostKeys: origin.trustedHostKeys,
    });
    const stage = `/tmp/towbar-domain-cleanup-${context.deploymentId}`;
    try {
      await session.run(
        String.raw`
set -euo pipefail
sudo python3 - "$1" apply "$2" <<'PYTHON'
${domainRoutingPython}
PYTHON
validate_args=(--config /etc/caddy/Caddyfile)
if sudo test -s /etc/caddy/towbar/cloudflare.env; then validate_args+=(--envfile /etc/caddy/towbar/cloudflare.env); fi
if ! sudo caddy validate "${"$"}{validate_args[@]}" || ! sudo systemctl reload caddy; then
  sudo python3 - "$1" rollback <<'PYTHON'
${domainRoutingPython}
PYTHON
  sudo caddy validate "${"$"}{validate_args[@]}"
  sudo systemctl reload caddy
  exit 1
fi
sudo rm -rf -- "$1"
`,
        [stage, JSON.stringify(handoffs)],
        { timeoutMs: 180_000 },
      );
    } finally {
      await session.close();
    }
  }
}

export class DomainHandoffRecoveryRequiredError extends Error {
  constructor(cause: unknown) {
    super(
      "Domain handoff rollback needs reconciliation before another deployment",
      { cause },
    );
    this.name = "DomainHandoffRecoveryRequiredError";
  }
}

export function throwIfDomainRecoveryFailed(
  context: DeploymentExecutionContext,
  errors: unknown[],
  cause: unknown,
) {
  if (context.domainHandoffs?.length && errors.length)
    throw new DomainHandoffRecoveryRequiredError(cause);
}

export function domainHandoffRoutingMessage(
  context: DeploymentExecutionContext,
) {
  const handoffs = context.domainHandoffs ?? [];
  if (!handoffs.length) return undefined;
  if (handoffs.length === 1)
    return `Moving ${handoffs[0]!.hostname} from ${handoffs[0]!.previousAppName} to ${context.app.name}`;
  return `Moving ${handoffs.length} domains to ${context.app.name}`;
}

export function assertDomainRollbackSafe(error: unknown, boundary: string) {
  if (
    boundary === "rollback" &&
    error instanceof DomainHandoffRecoveryRequiredError
  )
    throw error;
}
