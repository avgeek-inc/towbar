import { parseDocument } from "yaml";
import { z } from "zod";

import {
  ManifestValidationError,
  appSchema,
  digestValue,
  normalizeDeploymentManifest,
  resourceSchema,
  serverSlugSchema,
} from "./manifest.js";
import {
  isValidBranchName,
  normalizeRepositoryPath,
} from "./manifest-values.js";
import { secretKeySchema } from "./managed-secrets.js";

export const environmentNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,62}$/)
  .refine(
    (name) =>
      ![
        "preview",
        "previews",
        "__proto__",
        "constructor",
        "prototype",
      ].includes(name),
    "This environment name is reserved",
  );

export const sourceEnvironmentMappingSchema = z
  .object({
    environment: environmentNameSchema,
    branch: z
      .string()
      .min(1)
      .max(255)
      .refine(isValidBranchName, "Invalid Git branch name"),
  })
  .strict();

export const repositoryManifestSchema = z
  .object({
    version: z.literal(2),
    environments: z
      .record(
        environmentNameSchema,
        z
          .object({
            previews: z.object({ enabled: z.boolean() }).strict().optional(),
          })
          .strict(),
      )
      .refine(
        (value) => Object.keys(value).length > 0,
        "Declare at least one environment",
      ),
  })
  .strict();

const keysSchema = z
  .array(
    secretKeySchema.refine(
      (key) => !["__proto__", "constructor", "prototype"].includes(key),
      "Reserved secret key",
    ),
  )
  .max(200)
  .refine((keys) => new Set(keys).size === keys.length, "Duplicate secret key");
export const requiredSecretsSchema = z
  .object({
    build: keysSchema.default([]),
    runtime: keysSchema.default([]),
    preDeploy: keysSchema.default([]),
    postDeploy: keysSchema.default([]),
  })
  .strict();
export type RequiredSecrets = z.infer<typeof requiredSecretsSchema>;
export type RepositoryManifest = z.infer<typeof repositoryManifestSchema>;
export type RepositoryFile = { path: string; content: string };

function invalid(
  file: string,
  message: string,
  path: (string | number)[] = [],
): never {
  throw new ManifestValidationError([{ message, path: [file, ...path] }]);
}

function readYaml(file: RepositoryFile): unknown {
  if (Buffer.byteLength(file.content, "utf8") > 256 * 1024) {
    invalid(file.path, "File exceeds 256 KiB");
  }
  const document = parseDocument(file.content, {
    strict: true,
    uniqueKeys: true,
  });
  if (document.errors.length)
    invalid(
      file.path,
      document.errors.map((error) => error.message).join("; "),
    );
  try {
    return document.toJS({ maxAliasCount: 0 });
  } catch {
    invalid(file.path, "YAML aliases are not supported");
  }
}

function validate<T>(schema: z.ZodType<T>, value: unknown, file: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ManifestValidationError(
      result.error.issues.map((issue) => ({
        message: issue.message,
        path: [file, ...issue.path.map(String)],
      })),
    );
  }
  return result.data;
}

export function parseRepositoryManifest(content: string): RepositoryManifest {
  return validate(
    repositoryManifestSchema,
    readYaml({ path: "towbar.yml", content }),
    "towbar.yml",
  );
}

export function entityFileKind(
  filePath: string,
): "app" | "resource" | undefined {
  if (normalizeRepositoryPath(filePath) !== filePath)
    throw new Error("Entity paths must be canonical repository-relative paths");
  if (filePath.startsWith(".towbar/apps/") && filePath.endsWith(".app.yml"))
    return "app";
  if (
    filePath.startsWith(".towbar/resources/") &&
    filePath.endsWith(".resource.yml")
  )
    return "resource";
  return undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rejectUnsafeKeys(value: unknown, file: string): void {
  if (Array.isArray(value)) {
    value.forEach((item) => rejectUnsafeKeys(item, file));
  } else if (isObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (["__proto__", "constructor", "prototype"].includes(key))
        invalid(file, `Reserved key '${key}'`);
      rejectUnsafeKeys(child, file);
    }
  }
}

export function mergeEnvironmentConfiguration(
  defaults: Record<string, unknown>,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = Object.assign(
    Object.create(null),
    defaults,
  );
  for (const [key, value] of Object.entries(overrides)) {
    const existing = result[key];
    result[key] =
      isObject(existing) && isObject(value)
        ? mergeEnvironmentConfiguration(existing, value)
        : value;
  }
  return result;
}

/** Resolve one environment only; other environment settings never enter its digest. */
export function resolveRepositoryEnvironment(input: {
  root: string;
  files: RepositoryFile[];
  environment: string;
  branch: string;
}) {
  const root = parseRepositoryManifest(input.root);
  validate(
    sourceEnvironmentMappingSchema,
    { environment: input.environment, branch: input.branch },
    "towbar.yml",
  );
  const environment = root.environments[input.environment];
  if (!environment)
    invalid("towbar.yml", `Environment '${input.environment}' is not declared`);
  const apps: z.input<typeof appSchema>[] = [];
  const resources: z.input<typeof resourceSchema>[] = [];
  const declarations: Record<string, RequiredSecrets> = Object.create(null);
  const paths = new Set<string>();
  const identities = new Set<string>();
  if (input.files.length > 1000)
    invalid("towbar.yml", "At most 1000 entity files are supported");
  let totalBytes = 0;
  for (const file of [...input.files].sort((a, b) =>
    a.path.localeCompare(b.path),
  )) {
    const kind = entityFileKind(file.path);
    if (!kind) continue;
    if (paths.has(file.path)) invalid(file.path, "Duplicate file path");
    paths.add(file.path);
    totalBytes += Buffer.byteLength(file.content, "utf8");
    if (totalBytes > 8 * 1024 * 1024)
      invalid(file.path, "Entity files exceed 8 MiB in total");
    const value = readYaml(file);
    rejectUnsafeKeys(value, file.path);
    if (!isObject(value)) invalid(file.path, "Expected one entity object");
    const { environments, secrets, ...defaults } = value;
    const overrides = validate(
      z.record(environmentNameSchema, z.record(z.string(), z.unknown())),
      environments,
      file.path,
    );
    for (const [name, settings] of Object.entries(overrides)) {
      if (!root.environments[name])
        invalid(file.path, `Unknown environment '${name}'`, [
          "environments",
          name,
        ]);
      for (const key of [
        "id",
        "name",
        "type",
        "secrets",
        "preview",
        "environments",
      ]) {
        if (Object.hasOwn(settings, key))
          invalid(file.path, `'${key}' must be declared at entity level`, [
            "environments",
            name,
            key,
          ]);
      }
    }
    const id = validate(
      z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/),
      defaults.id,
      file.path,
    );
    const identity = `${kind}:${id}`;
    if (identities.has(identity))
      invalid(file.path, `Duplicate ${kind} id '${id}'`);
    identities.add(identity);
    const required = validate(requiredSecretsSchema, secrets ?? {}, file.path);
    if (kind === "resource" && required.build.length)
      invalid(file.path, "Resources do not support build secrets");
    const selected = overrides[input.environment];
    if (!selected) continue;
    const resolved = mergeEnvironmentConfiguration(defaults, selected);
    validate(serverSlugSchema, resolved.server, file.path);
    if (kind === "app") {
      const app = validate(appSchema, resolved, file.path);
      if (!environment.previews?.enabled) delete app.preview;
      apps.push(app);
    } else {
      resources.push(validate(resourceSchema, resolved, file.path));
    }
    declarations[identity] = required;
  }
  // Existing normalization supplies defaults for container, health, image and backup settings.
  const normalized = normalizeDeploymentManifest({
    version: 2,
    source: { branch: input.branch },
    apps,
    resources,
  });
  const manifest = {
    ...normalized,
    version: 2 as const,
    environment: input.environment,
    previewsEnabled: environment.previews?.enabled ?? false,
    requiredSecrets: declarations,
  };
  return { manifest, digest: digestValue(manifest) };
}
