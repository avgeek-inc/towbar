import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { parseDocument } from "yaml";

type ComposeValue = Record<string, unknown>;

const remoteReference = /^[a-z][a-z0-9+.-]*:\/\//iu;
const digestPinnedImage = /@sha256:[a-f0-9]{64}$/u;

export class UnsafeComposeConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeComposeConfigurationError";
  }
}

function record(value: unknown): ComposeValue | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as ComposeValue)
    : undefined;
}

function list(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function nonEmpty(value: unknown) {
  return (
    value !== undefined && value !== null && value !== false && value !== ""
  );
}

function reject(
  condition: boolean,
  message: string,
): asserts condition is false {
  if (condition) throw new UnsafeComposeConfigurationError(message);
}

async function repositoryPath(input: {
  root: string;
  base: string;
  value: unknown;
  label: string;
  kind: "file" | "directory";
}) {
  reject(
    typeof input.value !== "string" || input.value.trim() === "",
    `${input.label} must be a repository-relative path`,
  );
  const value = input.value as string;
  reject(
    value.includes("\0") || value.includes("$") || remoteReference.test(value),
    `${input.label} must be a literal repository path`,
  );
  reject(path.isAbsolute(value), `${input.label} cannot be an absolute path`);
  const lexical = path.resolve(input.base, value);
  reject(
    lexical !== input.root && !lexical.startsWith(`${input.root}${path.sep}`),
    `${input.label} escaped the repository checkout`,
  );
  let resolved: string;
  try {
    resolved = await realpath(lexical);
  } catch {
    throw new UnsafeComposeConfigurationError(`${input.label} does not exist`);
  }
  reject(
    resolved !== input.root && !resolved.startsWith(`${input.root}${path.sep}`),
    `${input.label} resolves outside the repository checkout`,
  );
  const stat = await lstat(lexical);
  reject(stat.isSymbolicLink(), `${input.label} cannot be a symbolic link`);
  reject(
    input.kind === "file" ? !stat.isFile() : !stat.isDirectory(),
    `${input.label} must be a ${input.kind}`,
  );
  return resolved;
}

function includeEntries(value: unknown): ComposeValue[] {
  return list(value).flatMap((entry) => {
    if (typeof entry === "string") return [{ path: entry }];
    const item = record(entry);
    if (!item) {
      throw new UnsafeComposeConfigurationError(
        "Compose include entries must be paths or objects",
      );
    }
    return [item];
  });
}

async function validateBuild(input: {
  build: unknown;
  root: string;
  base: string;
  service: string;
}) {
  if (typeof input.build === "string") {
    await repositoryPath({
      root: input.root,
      base: input.base,
      value: input.build,
      label: `Compose service ${input.service} build context`,
      kind: "directory",
    });
    return;
  }
  const build = record(input.build);
  if (!build) return;
  reject(
    Boolean(build.privileged) ||
      nonEmpty(build.ssh) ||
      nonEmpty(build.entitlements),
    `Compose service ${input.service} requests prohibited build privileges`,
  );
  reject(
    nonEmpty(build.cache_from) ||
      nonEmpty(build.cache_to) ||
      nonEmpty(build.output) ||
      nonEmpty(build.outputs),
    `Compose service ${input.service} cannot configure host-visible build caches or outputs`,
  );
  reject(
    nonEmpty(build.network) &&
      build.network !== "default" &&
      build.network !== "none",
    `Compose service ${input.service} must use default or disabled build networking`,
  );
  for (const host of list(build.extra_hosts))
    reject(
      String(host).toLowerCase().includes("host-gateway"),
      `Compose service ${input.service} cannot resolve the Docker host gateway while building`,
    );
  const context = await repositoryPath({
    root: input.root,
    base: input.base,
    value: build.context ?? ".",
    label: `Compose service ${input.service} build context`,
    kind: "directory",
  });
  if (build.dockerfile !== undefined) {
    await repositoryPath({
      root: input.root,
      base: context,
      value: build.dockerfile,
      label: `Compose service ${input.service} Dockerfile`,
      kind: "file",
    });
  }
  const additional = build.additional_contexts;
  const values = Array.isArray(additional)
    ? additional.map((entry) =>
        typeof entry === "string" ? entry.slice(entry.indexOf("=") + 1) : entry,
      )
    : Object.values(record(additional) ?? {});
  for (const [index, value] of values.entries()) {
    if (typeof value === "string" && value.startsWith("service:")) continue;
    await repositoryPath({
      root: input.root,
      base: input.base,
      value,
      label: `Compose service ${input.service} additional build context ${index + 1}`,
      kind: "directory",
    });
  }
}

async function validateService(input: {
  root: string;
  base: string;
  name: string;
  value: unknown;
  visit: (file: string) => Promise<void>;
}) {
  const service = record(input.value);
  if (!service)
    throw new UnsafeComposeConfigurationError(
      `Compose service ${input.name} must be an object`,
    );
  const forbiddenFields = [
    "container_name",
    "devices",
    "device_cgroup_rules",
    "gpus",
    "volumes_from",
    "external_links",
    "runtime",
    "develop",
    "cgroup",
    "cgroup_parent",
    "credential_spec",
    "use_api_socket",
  ];
  for (const field of forbiddenFields)
    reject(
      nonEmpty(service[field]),
      `Compose service ${input.name} cannot set ${field}`,
    );
  reject(
    Boolean(service.privileged),
    `Compose service ${input.name} cannot run privileged`,
  );
  for (const field of ["network_mode", "pid", "ipc", "uts", "userns_mode"])
    reject(
      nonEmpty(service[field]),
      `Compose service ${input.name} cannot join a host or external namespace through ${field}`,
    );
  reject(
    nonEmpty(service.cap_add),
    `Compose service ${input.name} cannot add Linux capabilities`,
  );
  reject(
    nonEmpty(service.security_opt),
    `Compose service ${input.name} cannot override container security options`,
  );
  for (const host of list(service.extra_hosts))
    reject(
      typeof host === "string" && host.toLowerCase().includes("host-gateway"),
      `Compose service ${input.name} cannot resolve the Docker host gateway`,
    );
  for (const [index, volume] of list(service.volumes).entries()) {
    const item = record(volume);
    if (item) {
      reject(
        item.type === "bind" || nonEmpty(item.bind),
        `Compose service ${input.name} cannot use host bind mount ${index + 1}`,
      );
      continue;
    }
    if (typeof volume === "string") {
      if (!volume.includes(":")) continue;
      const source = volume.split(":", 1)[0] ?? "";
      reject(
        source.startsWith(".") ||
          source.startsWith("/") ||
          source.includes("docker.sock"),
        `Compose service ${input.name} cannot use host bind mount ${index + 1}`,
      );
    }
  }
  for (const [index, port] of list(service.ports).entries()) {
    const item = record(port);
    if (item) {
      reject(
        item.host_ip !== "127.0.0.1" && item.host_ip !== "::1",
        `Compose service ${input.name} port ${index + 1} must bind to loopback`,
      );
      reject(
        nonEmpty(item.published) && String(item.published) !== "0",
        `Compose service ${input.name} cannot reserve a fixed host port`,
      );
    } else {
      reject(
        true,
        `Compose service ${input.name} cannot declare short-form published ports`,
      );
    }
  }
  for (const [index, envFile] of list(service.env_file).entries()) {
    await repositoryPath({
      root: input.root,
      base: input.base,
      value: record(envFile)?.path ?? envFile,
      label: `Compose service ${input.name} env_file ${index + 1}`,
      kind: "file",
    });
  }
  await validateBuild({
    build: service.build,
    root: input.root,
    base: input.base,
    service: input.name,
  });
  const extension = record(service.extends);
  if (extension?.file !== undefined) {
    const file = await repositoryPath({
      root: input.root,
      base: input.base,
      value: extension.file,
      label: `Compose service ${input.name} extends file`,
      kind: "file",
    });
    await input.visit(file);
  }
}

export async function validateComposeRepository(
  checkout: string,
  composeFiles: string[],
) {
  const root = await realpath(checkout);
  const visited = new Set<string>();
  const visit = async (candidate: string): Promise<void> => {
    const file = await repositoryPath({
      root,
      base: root,
      value: path.relative(root, candidate),
      label: "Compose file",
      kind: "file",
    });
    if (visited.has(file)) return;
    visited.add(file);
    const document = parseDocument(await readFile(file, "utf8"), {
      prettyErrors: false,
      uniqueKeys: true,
    });
    if (document.errors.length)
      throw new UnsafeComposeConfigurationError(
        `Compose file ${path.relative(root, file)} is invalid: ${document.errors[0]?.message ?? "YAML parse failed"}`,
      );
    const value = record(document.toJS({ maxAliasCount: 100 }));
    if (!value)
      throw new UnsafeComposeConfigurationError(
        `Compose file ${path.relative(root, file)} must contain an object`,
      );
    const base = path.dirname(file);
    for (const include of includeEntries(value.include)) {
      reject(
        nonEmpty(include.project_directory),
        "Compose include cannot override its project directory",
      );
      for (const [index, envFile] of list(include.env_file).entries())
        await repositoryPath({
          root,
          base,
          value: envFile,
          label: `Compose include env_file ${index + 1}`,
          kind: "file",
        });
      for (const includePath of list(include.path)) {
        const included = await repositoryPath({
          root,
          base,
          value: includePath,
          label: "Compose include",
          kind: "file",
        });
        await visit(included);
      }
    }
    for (const [name, service] of Object.entries(record(value.services) ?? {}))
      await validateService({ root, base, name, value: service, visit });
    for (const collectionName of [
      "volumes",
      "networks",
      "configs",
      "secrets",
    ] as const) {
      for (const [name, rawItem] of Object.entries(
        record(value[collectionName]) ?? {},
      )) {
        const item = record(rawItem);
        if (!item) continue;
        reject(
          Boolean(item.external) || nonEmpty(item.name),
          `Compose ${collectionName.slice(0, -1)} ${name} must remain project-scoped`,
        );
        if (collectionName === "volumes")
          reject(
            nonEmpty(item.driver) || nonEmpty(item.driver_opts),
            `Compose volume ${name} cannot configure a storage driver or host driver options`,
          );
        if (collectionName === "networks") {
          reject(
            nonEmpty(item.driver) && item.driver !== "bridge",
            `Compose network ${name} must use the bridge driver`,
          );
          reject(
            nonEmpty(item.driver_opts) || Boolean(item.attachable),
            `Compose network ${name} cannot set host driver options or allow external attachment`,
          );
        }
        if (
          (collectionName === "configs" || collectionName === "secrets") &&
          item.file !== undefined
        )
          await repositoryPath({
            root,
            base,
            value: item.file,
            label: `Compose ${collectionName.slice(0, -1)} ${name}`,
            kind: "file",
          });
      }
    }
  };

  for (const file of composeFiles) {
    const resolved = await repositoryPath({
      root,
      base: root,
      value: file,
      label: "Compose file",
      kind: "file",
    });
    await visit(resolved);
  }
}

export function assertRenderedComposeImage(image: unknown, service: string) {
  reject(
    typeof image === "string" && !digestPinnedImage.test(image),
    `Compose service ${service} image must be pinned by sha256 digest`,
  );
}
