import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { NormalizedServer } from "@workspace/towbar-core";
import { SshSession } from "./ssh.js";
import type { SshLoginSecret, TrustedHostKey } from "./types.js";

export type MonitoringAgentExecutionContext = {
  serverId: string;
  generation: string;
  desiredState: "enabled" | "disabled";
  config: NormalizedServer;
  login: SshLoginSecret;
  trustedHostKeys: TrustedHostKey[];
  endpoint: string;
  token: string | null;
};

const hardening = `
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
PrivateTmp=true
MemoryMax=64M
CPUQuota=5%
TasksMax=32
LimitNOFILE=128
Environment=GOMEMLIMIT=32MiB GOMAXPROCS=2
LogNamespace=towbar-monitoring
LogRateLimitIntervalSec=60s
LogRateLimitBurst=5
`;
export const monitoringCollectorUnit = `[Unit]
Description=Towbar monitoring collector
After=docker.service
Wants=docker.service
StartLimitIntervalSec=300
StartLimitBurst=5

[Service]
Type=simple
User=towbar-collector
Group=towbar-monitoring
SupplementaryGroups=docker
UMask=0027
RuntimeDirectory=towbar-monitoring
RuntimeDirectoryMode=0750
ExecStart=/usr/local/lib/towbar-monitoring/agent --mode=collect
Restart=on-failure
RestartSec=10
RestrictAddressFamilies=AF_UNIX
InaccessiblePaths=-/etc/towbar-monitoring
ReadWritePaths=/run/towbar-monitoring
${hardening}
[Install]
WantedBy=multi-user.target
`;
export const monitoringSenderUnit = `[Unit]
Description=Towbar monitoring sender
After=network-online.target towbar-monitoring-collector.service
Wants=network-online.target towbar-monitoring-collector.service
StartLimitIntervalSec=300
StartLimitBurst=5

[Service]
Type=simple
User=towbar-monitoring
Group=towbar-monitoring
UMask=0077
StateDirectory=towbar-monitoring
StateDirectoryMode=0700
ExecStart=/usr/local/lib/towbar-monitoring/agent --mode=send
Restart=on-failure
RestartPreventExitStatus=77
RestartSec=15
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
InaccessiblePaths=-/run/docker.sock -/var/run/docker.sock
ReadWritePaths=/var/lib/towbar-monitoring
${hardening}
[Install]
WantedBy=multi-user.target
`;
export const monitoringInstallScript = `set -euo pipefail
staging="$1"
digest="$2"
install -d -m 0700 /run/towbar-monitoring-install
exec 9>/run/towbar-monitoring-install/lock
flock -w 120 9
trap 'rm -rf -- "$staging"' EXIT
printf '%s  %s\\n' "$digest" "$staging/agent" | sha256sum --check --status
command -v systemctl >/dev/null
getent group docker >/dev/null
getent group towbar-monitoring >/dev/null || groupadd --system towbar-monitoring
id towbar-monitoring >/dev/null 2>&1 || useradd --system --gid towbar-monitoring --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin towbar-monitoring
id towbar-collector >/dev/null 2>&1 || useradd --system --gid towbar-monitoring --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin towbar-collector
install -d -m 0755 /usr/local/lib/towbar-monitoring
install -d -m 0750 -o root -g towbar-monitoring /etc/towbar-monitoring
install -m 0755 "$staging/agent" /usr/local/lib/towbar-monitoring/agent.new
/usr/local/lib/towbar-monitoring/agent.new --version >/dev/null
mv /usr/local/lib/towbar-monitoring/agent.new /usr/local/lib/towbar-monitoring/agent
install -m 0640 -o root -g towbar-monitoring "$staging/config.json" /etc/towbar-monitoring/config.json
install -m 0644 "$staging/collector.service" /etc/systemd/system/towbar-monitoring-collector.service
install -m 0644 "$staging/sender.service" /etc/systemd/system/towbar-monitoring.service
install -m 0644 "$staging/journal.conf" /etc/systemd/journald@towbar-monitoring.conf
systemctl daemon-reload
systemctl reset-failed towbar-monitoring-collector.service towbar-monitoring.service || true
systemctl enable towbar-monitoring-collector.service towbar-monitoring.service
systemctl restart towbar-monitoring-collector.service towbar-monitoring.service
systemctl is-active --quiet towbar-monitoring-collector.service
systemctl is-active --quiet towbar-monitoring.service
`;
export const monitoringUninstallScript = `set -euo pipefail
install -d -m 0700 /run/towbar-monitoring-install
exec 9>/run/towbar-monitoring-install/lock
flock -w 120 9
for unit in towbar-monitoring.service towbar-monitoring-collector.service; do
  if systemctl cat "$unit" >/dev/null 2>&1; then
    systemctl disable --now "$unit"
    if systemctl is-active --quiet "$unit"; then exit 1; fi
  fi
done
rm -f /etc/systemd/system/towbar-monitoring.service /etc/systemd/system/towbar-monitoring-collector.service
rm -rf /usr/local/lib/towbar-monitoring /etc/towbar-monitoring /var/lib/towbar-monitoring /run/towbar-monitoring
systemctl stop systemd-journald@towbar-monitoring.service systemd-journald@towbar-monitoring.socket systemd-journald-varlink@towbar-monitoring.socket || true
rm -f /etc/systemd/journald@towbar-monitoring.conf
systemctl daemon-reload
`;

export async function reconcileMonitoringAgent(
  context: MonitoringAgentExecutionContext,
  binaryDirectory: string,
  signal?: AbortSignal,
) {
  const session = await SshSession.connect({
    server: context.config,
    login: context.login,
    trustedHostKeys: context.trustedHostKeys,
  });
  let staging: string | undefined;
  let local: string | undefined;
  try {
    if (context.desiredState === "disabled") {
      await session.run(
        `sudo -n bash <<'TOWBAR_UNINSTALL'\n${monitoringUninstallScript}\nTOWBAR_UNINSTALL`,
        [],
        { signal, timeoutMs: 180_000 },
      );
      return;
    }
    if (!context.token) throw new Error("Monitoring credential is missing");
    const architecture = (
      await session.run("uname -m", [], { signal, timeoutMs: 10_000 })
    ).stdout.trim();
    const suffix =
      architecture === "x86_64"
        ? "amd64"
        : architecture === "aarch64"
          ? "arm64"
          : null;
    if (!suffix)
      throw new Error("Monitoring requires an AMD64 or ARM64 Linux server");
    const binary = path.join(
      binaryDirectory,
      `towbar-monitoring-linux-${suffix}`,
    );
    const digest = createHash("sha256")
      .update(await readFile(binary))
      .digest("hex");
    staging = (
      await session.run(
        "umask 077; mktemp -d /tmp/towbar-monitoring.XXXXXXXX",
        [],
        { signal, timeoutMs: 10_000 },
      )
    ).stdout.trim();
    if (!/^\/tmp\/towbar-monitoring\.[A-Za-z0-9]{8}$/u.test(staging))
      throw new Error("Unable to stage monitoring installation");
    local = await mkdtemp(path.join(tmpdir(), "towbar-monitoring-"));
    const files = {
      "config.json": JSON.stringify({
        serverId: context.serverId,
        endpoint: context.endpoint,
        token: context.token,
      }),
      "collector.service": monitoringCollectorUnit,
      "sender.service": monitoringSenderUnit,
      "journal.conf":
        "[Journal]\nStorage=volatile\nRuntimeMaxUse=8M\nRuntimeMaxFileSize=1M\nMaxRetentionSec=1day\n",
      "install.sh": monitoringInstallScript,
    };
    for (const [name, content] of Object.entries(files)) {
      const file = path.join(local, name);
      await writeFile(file, content, { mode: 0o600 });
      await session.upload(file, `${staging}/${name}`, {
        signal,
        timeoutMs: 30_000,
      });
    }
    await session.upload(binary, `${staging}/agent`, {
      signal,
      timeoutMs: 60_000,
    });
    await session.run(
      'sudo -n bash "$1/install.sh" "$1" "$2"',
      [staging, digest],
      { signal, timeoutMs: 180_000 },
    );
  } finally {
    if (staging)
      await session
        .run('rm -rf -- "$1"', [staging], { timeoutMs: 10_000 })
        .catch(() => undefined);
    if (local) await rm(local, { recursive: true, force: true });
    await session.close();
  }
}
