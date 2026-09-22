import { CommandError } from "./process.js";
import {
  createPreparationLog,
  redactPreparationOutput,
} from "./server-preparation-log.js";
import { HostKeyNotTrustedError, SshSession } from "./ssh.js";

import type { ServerPreparationStepId } from "@workspace/towbar-core";
import type {
  ServerPreparationContext,
  ServerPreparationHooks,
  ServerPreparationResult,
} from "./types.js";

const inspectServerScript = String.raw`
set -euo pipefail
. /etc/os-release
if test "$ID" != ubuntu; then
  printf 'Towbar supports Ubuntu servers; this host reports %s.\n' "${"$"}{PRETTY_NAME:-$ID}" >&2
  exit 72
fi
case "$VERSION_ID" in
  22.04|24.04|26.04) ;;
  *)
    printf 'Ubuntu %s is not supported. Use Ubuntu 22.04, 24.04, or 26.04 LTS.\n' "$VERSION_ID" >&2
    exit 72
    ;;
esac
if test "$(id -u)" -ne 0; then
  command -v sudo >/dev/null || {
    printf 'The SSH user is not root and sudo is unavailable.\n' >&2
    exit 72
  }
  sudo -n true 2>/dev/null || {
    printf 'The SSH user needs passwordless sudo access.\n' >&2
    exit 72
  }
fi
printf 'Operating system: %s\n' "$PRETTY_NAME" >&2
if test "$(id -u)" -eq 0; then
  printf '%s\n' 'Administrative access: root' >&2
else
  printf '%s\n' 'Administrative access: passwordless sudo verified' >&2
fi
printf '%s\n' "$PRETTY_NAME"
`;

const installPrerequisitesScript = String.raw`
set -euo pipefail
if test "$(id -u)" -eq 0; then SUDO=(); else SUDO=(sudo -n); fi
export DEBIAN_FRONTEND=noninteractive
"${"$"}{SUDO[@]}" apt-get update -qq >&2
"${"$"}{SUDO[@]}" apt-get install -y --no-install-recommends \
  apt-transport-https ca-certificates coreutils curl debian-archive-keyring \
  debian-keyring gnupg python3 sudo util-linux zstd unattended-upgrades >&2
printf '%s\n' "$(python3 --version 2>&1)"
`;

const installDockerScript = String.raw`
set -euo pipefail
if test "$(id -u)" -eq 0; then SUDO=(); else SUDO=(sudo -n); fi
docker_compatible=false
if command -v docker >/dev/null; then
  "${"$"}{SUDO[@]}" systemctl enable --now docker >/dev/null 2>&1 || true
  docker_version="$("${"$"}{SUDO[@]}" docker version --format '{{.Server.Version}}' 2>/dev/null || true)"
  docker_major="${"$"}{docker_version%%.*}"
  if test -n "$docker_major" && test "$docker_major" -ge 29 && \
    "${"$"}{SUDO[@]}" docker buildx build --help 2>&1 | grep -Fq -- '--resource'; then
    docker_compatible=true
  elif ! dpkg-query -W -f='${"$"}{Status}' docker-ce 2>/dev/null | grep -Fq 'install ok installed'; then
    printf 'An incompatible Docker installation is already present. Remove the conflicting installation before continuing.\n' >&2
    exit 72
  fi
fi
if test "$docker_compatible" = false; then
  conflicts="$({ dpkg-query -W -f='${"$"}{binary:Package} ${"$"}{db:Status-Abbrev}\n' \
    docker.io docker-compose docker-compose-v2 docker-doc docker-buildx \
    podman-docker containerd runc 2>/dev/null || true; } | \
    awk '$2 ~ /^ii/ {print $1}' | paste -sd, -)"
  if test -n "$conflicts"; then
    printf 'Conflicting container packages are installed: %s. Remove them before continuing.\n' "$conflicts" >&2
    exit 72
  fi
  "${"$"}{SUDO[@]}" install -m 0755 -d /etc/apt/keyrings
  key_file="$(mktemp)"
  curl --proto '=https' --tlsv1.2 -fsSL \
    https://download.docker.com/linux/ubuntu/gpg -o "$key_file"
  "${"$"}{SUDO[@]}" install -m 0644 "$key_file" /etc/apt/keyrings/docker.asc
  rm -f "$key_file"
  . /etc/os-release
  architecture="$(dpkg --print-architecture)"
  codename="${"$"}{UBUNTU_CODENAME:-$VERSION_CODENAME}"
  source_file="$(mktemp)"
  printf '%s\n' \
    'Types: deb' \
    'URIs: https://download.docker.com/linux/ubuntu' \
    "Suites: $codename" \
    'Components: stable' \
    "Architectures: $architecture" \
    'Signed-By: /etc/apt/keyrings/docker.asc' >"$source_file"
  "${"$"}{SUDO[@]}" install -m 0644 "$source_file" /etc/apt/sources.list.d/docker.sources
  rm -f "$source_file"
  export DEBIAN_FRONTEND=noninteractive
  "${"$"}{SUDO[@]}" apt-get update -qq >&2
  "${"$"}{SUDO[@]}" apt-get install -y --no-install-recommends \
    containerd.io docker-buildx-plugin docker-ce docker-ce-cli docker-compose-plugin \
    >&2
fi
"${"$"}{SUDO[@]}" systemctl enable --now docker >&2
docker_version="$("${"$"}{SUDO[@]}" docker version --format '{{.Server.Version}}')"
docker_major="${"$"}{docker_version%%.*}"
if test -z "$docker_major" || test "$docker_major" -lt 29; then
  printf 'Docker Engine 29 or newer is required; the server reports %s.\n' "$docker_version" >&2
  exit 72
fi
if ! "${"$"}{SUDO[@]}" docker buildx build --help 2>&1 | grep -Fq -- '--resource'; then
  printf '%s\n' 'Docker Buildx with per-build resource controls is required.' >&2
  exit 72
fi
printf '%s\n' "$docker_version"
`;

const installCaddyScript = String.raw`
set -euo pipefail
requires_cloudflare="$1"
if test "$(id -u)" -eq 0; then SUDO=(); else SUDO=(sudo -n); fi
has_caddy=false
if command -v caddy >/dev/null; then has_caddy=true; fi
if test "$has_caddy" = true && test "$requires_cloudflare" = true && \
  ! caddy list-modules 2>/dev/null | grep -Fx dns.providers.cloudflare >/dev/null; then
  if ! dpkg-query -W -f='${"$"}{Status}' caddy 2>/dev/null | grep -Fq 'install ok installed'; then
    printf 'The existing Caddy binary is not package-managed and lacks the Cloudflare DNS module. Remove it or use a fresh server.\n' >&2
    exit 72
  fi
fi
if test "$has_caddy" = false; then
  key_source="$(mktemp)"
  keyring="$(mktemp)"
  list_file="$(mktemp)"
  curl --proto '=https' --tlsv1.2 -1fsSL \
    https://dl.cloudsmith.io/public/caddy/stable/gpg.key -o "$key_source"
  gpg --dearmor --batch --yes --output "$keyring" "$key_source"
  curl --proto '=https' --tlsv1.2 -1fsSL \
    https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt -o "$list_file"
  "${"$"}{SUDO[@]}" install -m 0644 "$keyring" /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  "${"$"}{SUDO[@]}" install -m 0644 "$list_file" /etc/apt/sources.list.d/caddy-stable.list
  rm -f "$key_source" "$keyring" "$list_file"
  export DEBIAN_FRONTEND=noninteractive
  "${"$"}{SUDO[@]}" apt-get update -qq >&2
  "${"$"}{SUDO[@]}" apt-get install -y --no-install-recommends caddy >&2
fi
if test "$requires_cloudflare" = true && \
  ! caddy list-modules 2>/dev/null | grep -Fx dns.providers.cloudflare >/dev/null; then
  build_directory="$(mktemp -d)"
  "${"$"}{SUDO[@]}" docker run --rm \
    --entrypoint xcaddy \
    --volume "$build_directory:/out" \
    caddy:2.11.4-builder \
    build v2.11.4 \
    --with github.com/caddy-dns/cloudflare@v0.2.4 \
    --output /out/caddy >&2
  "${"$"}{SUDO[@]}" test -x "$build_directory/caddy"
  "${"$"}{SUDO[@]}" "$build_directory/caddy" list-modules | grep -Fx dns.providers.cloudflare >/dev/null
  if ! "${"$"}{SUDO[@]}" dpkg-divert --list /usr/bin/caddy | grep -Fq /usr/bin/caddy.default; then
    "${"$"}{SUDO[@]}" dpkg-divert --divert /usr/bin/caddy.default --rename /usr/bin/caddy >&2
  fi
  "${"$"}{SUDO[@]}" install -m 0755 "$build_directory/caddy" /usr/bin/caddy.custom
  "${"$"}{SUDO[@]}" update-alternatives --install /usr/bin/caddy caddy /usr/bin/caddy.default 10 >&2
  "${"$"}{SUDO[@]}" update-alternatives --install /usr/bin/caddy caddy /usr/bin/caddy.custom 50 >&2
  "${"$"}{SUDO[@]}" rm -rf "$build_directory"
fi
"${"$"}{SUDO[@]}" install -d -m 0755 /etc/caddy /etc/caddy/towbar
"${"$"}{SUDO[@]}" systemctl enable --now caddy >&2
if test "$requires_cloudflare" = true; then
  caddy list-modules | grep -Fx dns.providers.cloudflare >/dev/null
fi
printf '%s\n' "$(caddy version | awk '{print $1}')"
`;

const configureAccessScript = String.raw`
set -euo pipefail
ssh_user="$1"
if test "$(id -u)" -eq 0; then SUDO=(); else SUDO=(sudo -n); fi
"${"$"}{SUDO[@]}" install -d -m 0755 /etc/caddy/towbar /var/lib/towbar
if test "$ssh_user" != root; then
  id "$ssh_user" >/dev/null
  "${"$"}{SUDO[@]}" usermod -aG docker "$ssh_user"
  id -nG "$ssh_user" | tr ' ' '\n' | grep -Fxq docker
fi
printf '%s\n' 'Towbar directories and Docker access configured'
`;

const verifyServerScript = String.raw`
set -euo pipefail
requires_cloudflare="$1"
ssh_user="$2"
if test "$(id -u)" -eq 0; then SUDO=(); else SUDO=(sudo -n); fi
. /etc/os-release
command -v docker >/dev/null
command -v caddy >/dev/null
command -v python3 >/dev/null
command -v timeout >/dev/null
command -v zstd >/dev/null
"${"$"}{SUDO[@]}" systemctl is-active --quiet docker
"${"$"}{SUDO[@]}" systemctl is-active --quiet caddy
"${"$"}{SUDO[@]}" docker info >/dev/null
"${"$"}{SUDO[@]}" docker buildx build --help 2>&1 | grep -Fq -- '--resource'
if test "$ssh_user" != root; then
  id -nG "$ssh_user" | tr ' ' '\n' | grep -Fxq docker
fi
if test "$requires_cloudflare" = true; then
  caddy list-modules | grep -Fx dns.providers.cloudflare >/dev/null
fi
"${"$"}{SUDO[@]}" test -d /etc/caddy/towbar
validate_args=(--config /etc/caddy/Caddyfile)
if "${"$"}{SUDO[@]}" test -s /etc/caddy/towbar/cloudflare.env; then
  validate_args+=(--envfile /etc/caddy/towbar/cloudflare.env)
fi
"${"$"}{SUDO[@]}" caddy validate "${"$"}{validate_args[@]}" >/dev/null
disk_available="$(df -Pk /var/lib/docker | awk 'NR==2 {print $4}')"
if test "$disk_available" -le 1048576; then
  printf 'At least 1 GiB of free space is required under /var/lib/docker.\n' >&2
  exit 72
fi
printf '%s\n' \
  "$PRETTY_NAME" \
  "$("${"$"}{SUDO[@]}" docker version --format '{{.Server.Version}}')" \
  "$(caddy version | awk '{print $1}')" \
  "$(python3 --version 2>&1)" \
  "$(zstd --version | head -n 1)" \
  "$disk_available"
`;

const cleanupExistingAppsScript = String.raw`
set -euo pipefail
deployable_ids="$1"
python3 - "$deployable_ids" <<'PYTHON'
import json
import subprocess
import sys

deployable_ids = set(json.loads(sys.argv[1]))
containers = subprocess.run(
    ["docker", "ps", "--all", "--quiet", "--filter", "label=towbar.managed=true"],
    check=False,
    capture_output=True,
    text=True,
).stdout.split()
cleaned = 0
for container in containers:
    inspected = subprocess.run(
        ["docker", "inspect", "--format", '{{index .Config.Labels "towbar.deployable"}}', container],
        check=False,
        capture_output=True,
        text=True,
    )
    if inspected.returncode or inspected.stdout.strip() not in deployable_ids:
        continue
    removed = subprocess.run(
        ["docker", "rm", "--force", container],
        check=False,
        capture_output=True,
        text=True,
    )
    if removed.returncode == 0:
        cleaned += 1
print(cleaned)
PYTHON
`;

export const serverPreparationScripts = {
  cleanupExistingApps: cleanupExistingAppsScript,
  configureAccess: configureAccessScript,
  inspectServer: inspectServerScript,
  installCaddy: installCaddyScript,
  installDocker: installDockerScript,
  installPrerequisites: installPrerequisitesScript,
  verifyServer: verifyServerScript,
} as const;

export class ServerPreparationError extends Error {
  constructor(
    readonly stepId: ServerPreparationStepId,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ServerPreparationError";
  }
}

export async function prepareServer(
  context: ServerPreparationContext,
  executionHooks: ServerPreparationHooks,
): Promise<ServerPreparationResult> {
  const sensitiveValues = [
    context.login.privateKey,
    ...context.login.privateKey.split(/\r?\n/),
  ].filter(Boolean);
  const hooks: ServerPreparationHooks = {
    ...executionHooks,
    step: (event) =>
      executionHooks.step({
        ...event,
        message: redactPreparationOutput(event.message, sensitiveValues),
      }),
  };
  const logs = new Map<
    ServerPreparationStepId,
    ReturnType<typeof createPreparationLog>
  >();
  const stepLog = (id: ServerPreparationStepId) => {
    let log = logs.get(id);
    if (!log) {
      log = createPreparationLog({
        sensitiveValues,
        publish: async (content, truncated) => {
          await hooks.log?.({ id, log: content, logTruncated: truncated });
        },
      });
      logs.set(id, log);
    }
    return log;
  };
  const connectionLog = stepLog("connecting");
  await hooks.step({
    id: "connecting",
    message: "Connecting with the pinned SSH host key",
    status: "running",
  });
  let session: SshSession;
  try {
    await connectionLog.append(
      "stdout",
      `Testing SSH access to ${context.config.ssh.username}@${context.config.ssh.host || context.config.ip}:${context.config.ssh.port} using ${context.privateKeyName ? `stored private key “${context.privateKeyName}”` : "the stored private key"}.\n`,
    );
    session = await SshSession.connect({
      login: context.login,
      server: context.config,
      trustedHostKeys: context.trustedHostKeys,
    });
    await connectionLog.append(
      "stdout",
      "Pinned host key matched. SSH authentication succeeded. Remote command: true (exit 0).\n",
    );
    await connectionLog.finish();
    await hooks.step({
      id: "connecting",
      message: `SSH connection successfully tested as ${context.config.ssh.username} using ${context.privateKeyName ? `private key “${context.privateKeyName}”` : "the stored private key"}. The server identity matched a trusted host key.`,
      status: "succeeded",
    });
  } catch (error) {
    const message = preparationErrorMessage(error, sensitiveValues);
    await connectionLog.append("stderr", `${message}\n`);
    await connectionLog.finish();
    await hooks.step({
      id: "connecting",
      message,
      status: "failed",
    });
    throw new ServerPreparationError("connecting", message, { cause: error });
  }

  const runPreparationStep = (
    input: Omit<
      Parameters<typeof runStep>[0],
      "hooks" | "session" | "log" | "sensitiveValues"
    >,
  ) =>
    runStep({
      ...input,
      hooks,
      session,
      log: stepLog(input.id),
      sensitiveValues,
    });
  try {
    const operatingSystem = await runPreparationStep({
      id: "inspecting",
      runningMessage: "Checking Ubuntu and administrative access",
      script: inspectServerScript,
      success: (output) =>
        `${output} is supported. Checked the Ubuntu release and confirmed root or passwordless sudo access for ${context.config.ssh.username}.`,
      timeoutMs: 30_000,
    });
    const pythonVersion = await runPreparationStep({
      id: "installing_prerequisites",
      runningMessage: "Installing signed-package tooling and Python",
      script: installPrerequisitesScript,
      success: (output) =>
        `${output} is available. Updated the APT package index and installed HTTPS transport, CA certificates, curl, GnuPG, archive keyrings, coreutils, and sudo.`,
      timeoutMs: 5 * 60_000,
    });
    const dockerVersion = await runPreparationStep({
      id: "installing_docker",
      runningMessage: "Installing or validating Docker Engine",
      script: installDockerScript,
      success: (output) =>
        `Docker Engine ${output} is running and enabled at boot. Checked compatibility and installed Docker Engine, containerd, Buildx, and Compose when needed.`,
      timeoutMs: 10 * 60_000,
    });
    if (context.cleanupDeployableIds?.length) {
      try {
        const { stdout } = await session.run(
          cleanupExistingAppsScript,
          [JSON.stringify(context.cleanupDeployableIds)],
          {
            timeoutMs: 5 * 60_000,
            onStdout: (content) =>
              stepLog("installing_docker").append("stdout", content),
            onStderr: (content) =>
              stepLog("installing_docker").append("stderr", content),
          },
        );
        await hooks.step({
          id: "installing_docker",
          message: `Docker ${dockerVersion} is running; removed ${Number(stdout.trim()) || 0} existing app containers`,
          status: "succeeded",
        });
      } catch {
        await hooks.step({
          id: "installing_docker",
          message: `Docker ${dockerVersion} is running; existing app container cleanup could not complete`,
          status: "succeeded",
        });
      } finally {
        await stepLog("installing_docker").finish();
      }
    }
    const caddyVersion = await runPreparationStep({
      args: [String(Boolean(context.config.proxy?.cloudflare))],
      id: "installing_caddy",
      runningMessage: "Installing or validating Caddy",
      script: installCaddyScript,
      success: (output) =>
        `Caddy ${output} is running and enabled at boot. Created /etc/caddy and /etc/caddy/towbar.${context.config.proxy?.cloudflare ? " Verified the Cloudflare DNS module, building it when needed." : " Used the existing Caddy binary or installed the signed upstream package."}`,
      timeoutMs: 15 * 60_000,
    });
    await runPreparationStep({
      args: [context.config.ssh.username],
      id: "configuring_access",
      runningMessage: "Creating Towbar directories and Docker access",
      script: configureAccessScript,
      success: () =>
        `Created /etc/caddy/towbar and /var/lib/towbar with mode 0755.${context.config.ssh.username === "root" ? " The root SSH user already has Docker access." : ` Added ${context.config.ssh.username} to the Docker group and verified membership.`}`,
      timeoutMs: 60_000,
    });
    const verification = await runPreparationStep({
      args: [
        String(Boolean(context.config.proxy?.cloudflare)),
        context.config.ssh.username,
      ],
      id: "verifying",
      runningMessage: "Verifying services and deployment prerequisites",
      script: verifyServerScript,
      success: (output) => {
        const [os, docker, caddy, python, zstd, disk] = output.split("\n");
        if (
          !os ||
          !docker ||
          !caddy ||
          !python ||
          !zstd ||
          !disk ||
          !Number.isFinite(Number(disk)) ||
          Number(disk) <= 1_048_576
        ) {
          throw new Error(
            "Server verification returned an incomplete or invalid result",
          );
        }
        return `Verified ${os}, Docker ${docker}, Caddy ${caddy}, ${python}, and ${zstd}. Docker and Caddy are active, Docker responds, the Caddy configuration is valid, and deployment directories and Docker access are available. Free Docker disk space: ${(Number(disk) / 1_048_576).toFixed(1)} GiB (minimum 1 GiB).${context.config.proxy?.cloudflare ? " Cloudflare DNS module verified." : ""}`;
      },
      timeoutMs: 60_000,
    });
    const values = verification.split("\n");
    const [
      verifiedOs,
      verifiedDocker,
      verifiedCaddy,
      verifiedPython,
      verifiedZstd,
      disk,
    ] = values;
    if (
      !verifiedOs ||
      !verifiedDocker ||
      !verifiedCaddy ||
      !verifiedPython ||
      !verifiedZstd ||
      !disk
    ) {
      throw new ServerPreparationError(
        "verifying",
        "Server verification returned an incomplete result",
      );
    }
    return {
      caddyVersion: verifiedCaddy || caddyVersion,
      diskAvailableKb: Number(disk),
      dockerVersion: verifiedDocker || dockerVersion,
      operatingSystem: verifiedOs || operatingSystem,
      pythonVersion: verifiedPython || pythonVersion,
      zstdVersion: verifiedZstd,
    };
  } finally {
    await session.close();
  }
}

async function runStep(input: {
  args?: string[];
  hooks: ServerPreparationHooks;
  id: Exclude<ServerPreparationStepId, "connecting">;
  log: ReturnType<typeof createPreparationLog>;
  sensitiveValues: string[];
  runningMessage: string;
  script: string;
  session: SshSession;
  success: (output: string) => string;
  timeoutMs: number;
}) {
  await input.hooks.step({
    id: input.id,
    message: input.runningMessage,
    status: "running",
  });
  try {
    const { stdout } = await input.session.run(input.script, input.args ?? [], {
      timeoutMs: input.timeoutMs,
      onStdout: (content) => input.log.append("stdout", content),
      onStderr: (content) => input.log.append("stderr", content),
    });
    await input.log.finish();
    const output = stdout.trim();
    await input.hooks.step({
      id: input.id,
      message: input.success(output),
      status: "succeeded",
    });
    return output;
  } catch (error) {
    const message = preparationErrorMessage(error, input.sensitiveValues);
    await input.log.append("stderr", `${message}\n`);
    await input.log.finish();
    await input.hooks.step({
      id: input.id,
      message,
      status: "failed",
    });
    throw new ServerPreparationError(input.id, message, { cause: error });
  }
}

export function preparationErrorMessage(
  error: unknown,
  sensitiveValues: string[] = [],
) {
  if (error instanceof HostKeyNotTrustedError) {
    return "The server SSH host key is not trusted";
  }
  const detail =
    error instanceof CommandError
      ? error.stderr.trim() || error.stdout.trim() || error.message
      : error instanceof Error
        ? error.message
        : "Server preparation failed";
  // Caddy writes informational JSON before its actual validation error.
  // Retain actionable output before applying the persisted message limit.
  const diagnostic =
    detail
      .split("\n")
      .filter((line) => {
        try {
          const entry = JSON.parse(line) as { level?: string };
          return !["debug", "info", "warn"].includes(entry?.level ?? "");
        } catch {
          return true;
        }
      })
      .join("\n")
      .trim() || detail;
  const safeDiagnostic = redactPreparationOutput(diagnostic, sensitiveValues);
  const message = [...safeDiagnostic]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 || codePoint === 127 ? " " : character;
    })
    .join("")
    .trim();
  return message.length > 800 ? `…${message.slice(-799)}` : message;
}
