import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { NormalizedServer } from "@workspace/towbar-core";

import { runCommand } from "./process.js";

import type { SshLoginSecret, TrustedHostKey } from "./types.js";
import type { CommandOutputHandlers } from "./process.js";

export class HostKeyNotTrustedError extends Error {
  constructor(readonly discovered: TrustedHostKey[]) {
    super("The server SSH host key has not been explicitly trusted");
    this.name = "HostKeyNotTrustedError";
  }
}

export class SshSession {
  private constructor(
    readonly server: NormalizedServer,
    private readonly directory: string,
    private readonly keyPath: string,
    private readonly knownHostsPath: string,
  ) {}

  static async connect(input: {
    login: SshLoginSecret;
    server: NormalizedServer;
    trustedHostKeys: TrustedHostKey[];
  }) {
    const discovered = await scanHostKeys(input.server);
    const trusted = discovered.filter((candidate) =>
      input.trustedHostKeys.some(
        (pinned) =>
          pinned.fingerprint === candidate.fingerprint &&
          pinned.publicKey === candidate.publicKey,
      ),
    );
    if (trusted.length === 0) throw new HostKeyNotTrustedError(discovered);

    const directory = await mkdtemp(path.join(tmpdir(), "towbar-ssh-"));
    const keyPath = path.join(directory, "identity");
    const knownHostsPath = path.join(directory, "known_hosts");
    await writeFile(keyPath, `${input.login.privateKey.trim()}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await writeFile(
      knownHostsPath,
      trusted.map((key) => knownHostsLine(input.server, key)).join("\n") + "\n",
      { encoding: "utf8", mode: 0o600 },
    );
    await chmod(directory, 0o700);
    const session = new SshSession(
      input.server,
      directory,
      keyPath,
      knownHostsPath,
    );
    await session.run("true", [], { timeoutMs: 15_000 });
    return session;
  }

  async run(
    script: string,
    args: string[] = [],
    options: CommandOutputHandlers & {
      signal?: AbortSignal;
      timeoutMs?: number;
    } = {},
  ) {
    return await runCommand(
      "ssh",
      [
        ...this.sshOptions(),
        this.destination(),
        `bash -s -- ${args.map(shellQuote).join(" ")}`,
      ],
      {
        input: script,
        onStderr: options.onStderr,
        onStdout: options.onStdout,
        signal: options.signal,
        timeoutMs: options.timeoutMs,
      },
    );
  }

  async upload(
    localPath: string,
    remotePath: string,
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
  ) {
    return await runCommand(
      "scp",
      [
        "-q",
        "-i",
        this.keyPath,
        "-o",
        "BatchMode=yes",
        "-o",
        "IdentitiesOnly=yes",
        "-o",
        "StrictHostKeyChecking=yes",
        "-o",
        `UserKnownHostsFile=${this.knownHostsPath}`,
        "-P",
        String(this.server.ssh.port),
        localPath,
        `${this.destination()}:${remotePath}`,
      ],
      options,
    );
  }

  async download(
    remotePath: string,
    localPath: string,
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
  ) {
    return await runCommand(
      "scp",
      [
        "-q",
        "-i",
        this.keyPath,
        "-o",
        "BatchMode=yes",
        "-o",
        "IdentitiesOnly=yes",
        "-o",
        "StrictHostKeyChecking=yes",
        "-o",
        `UserKnownHostsFile=${this.knownHostsPath}`,
        "-P",
        String(this.server.ssh.port),
        `${this.destination()}:${remotePath}`,
        localPath,
      ],
      options,
    );
  }

  async close() {
    await rm(this.directory, { force: true, recursive: true });
  }

  private destination() {
    const host = sshConnectionHost(this.server);
    const ip = host.includes(":") ? `[${host}]` : host;
    return `${this.server.ssh.username}@${ip}`;
  }

  private sshOptions() {
    return [
      "-i",
      this.keyPath,
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      "-o",
      "IdentitiesOnly=yes",
      "-o",
      "StrictHostKeyChecking=yes",
      "-o",
      `UserKnownHostsFile=${this.knownHostsPath}`,
      "-p",
      String(this.server.ssh.port),
    ];
  }
}

export async function scanHostKeys(server: NormalizedServer) {
  const host = sshConnectionHost(server);
  const { stdout } = await runCommand(
    "ssh-keyscan",
    ["-T", "10", "-p", String(server.ssh.port), host],
    { timeoutMs: 15_000 },
  );
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  const unique = new Map<string, TrustedHostKey>();
  for (const line of lines) {
    const parts = line.split(/\s+/u);
    const algorithm = parts[1];
    const key = parts[2];
    if (!algorithm || !key) continue;
    const publicKey = `${algorithm} ${key}`;
    const { stdout: fingerprintOutput } = await runCommand(
      "ssh-keygen",
      ["-lf", "-", "-E", "sha256"],
      { input: `${publicKey}\n` },
    );
    const fingerprint = fingerprintOutput.trim().split(/\s+/u)[1];
    if (!fingerprint) continue;
    unique.set(fingerprint, { algorithm, fingerprint, publicKey });
  }
  if (unique.size === 0)
    throw new Error("The server did not present an SSH host key");
  return [...unique.values()];
}

function knownHostsLine(server: NormalizedServer, key: TrustedHostKey) {
  const connectionHost = sshConnectionHost(server);
  const host =
    server.ssh.port === 22
      ? connectionHost
      : `[${connectionHost}]:${server.ssh.port}`;
  return `${host} ${key.publicKey}`;
}

export function sshConnectionHost(server: NormalizedServer) {
  // Deployment snapshots written before ssh.host existed remain executable.
  return server.ssh.host || server.ip;
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
