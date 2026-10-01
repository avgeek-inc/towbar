import { createHash } from "node:crypto";
import { lstat, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ConfigurationFile } from "@workspace/towbar-core";
import type { DeploymentExecutionContext } from "./types.js";
import type { SshSession } from "./ssh.js";

const maxFileBytes = 16 * 1024 * 1024;
const maxTotalBytes = 64 * 1024 * 1024;

export async function readConfigurationFiles(
  checkout: string,
  files: ConfigurationFile[],
) {
  const root = await realpath(checkout);
  let bytes = 0;
  const result = [];
  for (const file of files) {
    if (
      !/^[A-Za-z0-9_./-]+$/.test(file.source) ||
      file.source.startsWith("/") ||
      file.source
        .split("/")
        .some((part) => !part || part === "." || part === "..")
    )
      throw new Error("Invalid repository configuration source");
    let current = root;
    for (const part of file.source.split("/")) {
      current = path.join(current, part);
      if ((await lstat(current)).isSymbolicLink())
        throw new Error(
          `Configuration source '${file.source}' cannot traverse symlinks`,
        );
    }
    const info = await lstat(current);
    if (!info.isFile() || info.size > maxFileBytes)
      throw new Error(
        `Configuration source '${file.source}' must be a regular file of at most 16 MiB`,
      );
    bytes += info.size;
    if (bytes > maxTotalBytes)
      throw new Error("Configuration files exceed 64 MiB");
    const content = await readFile(current);
    result.push({
      file,
      content,
      sha256: createHash("sha256").update(content).digest("hex"),
    });
  }
  return result;
}

export function configurationDirectory(context: DeploymentExecutionContext) {
  const release =
    context.kind === "rollback"
      ? context.rollbackRelease?.sourceDeploymentId
      : context.deploymentId;
  if (
    !release ||
    ![context.deployableId, release].every((value) =>
      /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value),
    )
  )
    throw new Error("Invalid configuration release identity");
  return `/var/lib/towbar/config-files/${context.deployableId}/${release}`;
}

export const configurationFilesRemoteScript = String.raw`
set -euo pipefail
payload="$1"
python3 - "$payload" <<'PYTHON'
import hashlib, json, os, shutil, stat, subprocess, sys, tempfile
from pathlib import Path
payload = json.loads(Path(sys.argv[1]).read_text())
destination = Path(payload["directory"])
def reject_symlinks(target):
    for part in [target, *target.parents]:
        if part.is_symlink(): raise SystemExit("Configuration storage cannot traverse symlinks")
reject_symlinks(destination)
identity = {key: payload[key] for key in ("sourceId", "deployableId", "commitSha", "files")}
receipt = destination / "receipt.json"
if payload["rollback"] or receipt.exists():
    reject_symlinks(receipt)
    if json.loads(receipt.read_text()) != identity: raise SystemExit("Retained configuration does not match the release")
else:
    subprocess.run(["sudo", "install", "-d", "-m", "0755", "-o", str(os.getuid()), "-g", str(os.getgid()), str(destination.parent)], check=True)
    stage = Path(tempfile.mkdtemp(prefix=".pending-", dir=destination.parent))
    try:
        for index, file in enumerate(payload["files"]):
            source = Path(payload["staging"]) / str(index)
            if not stat.S_ISREG(source.lstat().st_mode): raise SystemExit("Configuration upload must be a regular file")
            content = source.read_bytes()
            if hashlib.sha256(content).hexdigest() != file["sha256"]: raise SystemExit("Configuration upload checksum mismatch")
            target = stage / str(index)
            target.write_bytes(content)
            target.chmod(int(file.get("mode", "0444"), 8))
        (stage / "receipt.json").write_text(json.dumps(identity))
        (stage / "receipt.json").chmod(0o444)
        stage.chmod(0o755)
        os.rename(stage, destination)
    finally:
        if stage.exists(): shutil.rmtree(stage)
for index, file in enumerate(payload["files"]):
    target = destination / str(index)
    if not stat.S_ISREG(target.lstat().st_mode) or hashlib.sha256(target.read_bytes()).hexdigest() != file["sha256"] or stat.S_IMODE(target.stat().st_mode) != int(file.get("mode", "0444"), 8):
        raise SystemExit("Retained configuration failed integrity verification")
PYTHON
`;

export async function prepareConfigurationFiles(input: {
  checkout?: string;
  context: DeploymentExecutionContext;
  localDirectory: string;
  remoteDirectory: string;
  session: SshSession;
  signal?: AbortSignal;
}) {
  const files =
    "configFiles" in input.context.app.container
      ? (input.context.app.container.configFiles ?? [])
      : [];
  if (!files.length) return;
  const directory = configurationDirectory(input.context);
  const staging = `${input.remoteDirectory}/config-files`;
  let entries: Array<ConfigurationFile & { sha256: string }>;
  if (input.context.kind === "rollback") {
    const { stdout } = await input.session.run(
      'cat "$1/receipt.json"',
      [directory],
      { signal: input.signal },
    );
    const retained = JSON.parse(stdout) as {
      files: Array<ConfigurationFile & { sha256: string }>;
    };
    if (
      JSON.stringify(
        retained.files.map(({ sha256: _hash, ...file }) => file),
      ) !== JSON.stringify(files)
    )
      throw new Error(
        "Retained configuration targets differ from the release snapshot",
      );
    entries = retained.files;
  } else {
    if (!input.checkout)
      throw new Error(
        "Configuration files require an immutable source checkout",
      );
    const read = await readConfigurationFiles(input.checkout, files);
    await input.session.run('install -d -m 700 "$1"', [staging], {
      signal: input.signal,
    });
    entries = [];
    for (const [index, { file, content, sha256 }] of read.entries()) {
      const localPath = path.join(input.localDirectory, `config-${index}`);
      await writeFile(localPath, content, { mode: 0o600 });
      await input.session.upload(localPath, `${staging}/${index}`, {
        signal: input.signal,
      });
      entries.push({ ...file, sha256 });
    }
  }
  const payloadPath = path.join(input.localDirectory, "config-files.json");
  await writeFile(
    payloadPath,
    JSON.stringify({
      directory,
      staging,
      files: entries,
      sourceId: input.context.sourceId,
      deployableId: input.context.deployableId,
      commitSha: input.context.commitSha,
      rollback: input.context.kind === "rollback",
    }),
    { mode: 0o600 },
  );
  await input.session.upload(
    payloadPath,
    `${input.remoteDirectory}/config-files.json`,
    { signal: input.signal },
  );
  await input.session.run(
    configurationFilesRemoteScript,
    [`${input.remoteDirectory}/config-files.json`],
    { signal: input.signal },
  );
}

export function configurationMountArguments(
  context: DeploymentExecutionContext,
) {
  const files =
    "configFiles" in context.app.container
      ? (context.app.container.configFiles ?? [])
      : [];
  if (!files.length) return [];
  return files.flatMap((file, index) => [
    "--mount",
    `type=bind,src=${configurationDirectory(context)}/${index},dst=${file.mountPath},readonly`,
  ]);
}
