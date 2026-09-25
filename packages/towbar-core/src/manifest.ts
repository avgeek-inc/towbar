import { type AppJob, appJobSchema } from "./app-jobs.js";
import {
  type ManifestNotifications,
  manifestNotificationsSchema,
  normalizeManifestNotifications,
} from "./notifications.js";
/* eslint-disable max-lines -- The versioned manifest schema, normalized DTO, and parser stay together so their public contract cannot drift across modules. */

import { isIP } from "node:net";
import path from "node:path";

import { Cron } from "croner";
import { z } from "zod";

import {
  canonicalIp,
  findDuplicates,
  isValidBranchName,
  normalizeDomain,
  normalizeRepositoryPath,
} from "./manifest-values.js";
import {
  type AppDeployment,
  type ComposeWorkload,
  appDeploymentSchema,
  buildServerSelectionSchema,
  composeWorkloadSchema,
  externalSecretReferenceSchema,
  ingressSchema,
  integrationReferenceSchema,
  rolloutStrategySchema,
} from "./platform-expansion.js";

export {
  digestValue,
  normalizeDomain,
  normalizeRepositoryPath,
  stableStringify,
  validateSecretObject,
  validateServerLoginSecret,
} from "./manifest-values.js";

const appIdPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const deploymentInputGroupPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const dockerNetworkPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const dockerMemoryPattern = /^\d+(?:\.\d+)?[bkmg]$/i;
const dockerVolumePattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const dockerImagePattern = /^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,511}$/;
const s3BucketPattern =
  /^(?!\d+\.\d+\.\d+\.\d+$)[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const gcsBucketPattern =
  /^(?!\d+\.\d+\.\d+\.\d+$)[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/;
export const managedResourceTypes = [
  "postgres",
  "mysql",
  "mariadb",
  "mongodb",
  "redis",
  "dragonfly",
  "keydb",
  "clickhouse",
] as const;
export type ManagedResourceType = (typeof managedResourceTypes)[number];
export type ResourceType = "image" | ManagedResourceType;
export type DeployableKind = "app" | "compose" | ResourceType;

export const managedResourceCompatibility = {
  postgres: {
    image:
      "postgres:17-alpine@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73",
    architectures: ["amd64", "arm64"],
    majorVersion: 17,
  },
  mysql: {
    image:
      "mysql:8.4@sha256:85b9bf2e29cf836ecb8c2a15a935d4ba0c606631dff1dd79531a11983c638f2a",
    architectures: ["amd64", "arm64"],
    majorVersion: 8,
  },
  mariadb: {
    image:
      "mariadb:11.8@sha256:8b5f33ebd85d1775657e974ed10434128bb493c80e826ceaa54074fd1a92a112",
    architectures: ["amd64", "arm64"],
    majorVersion: 11,
  },
  mongodb: {
    image:
      "mongo:8.0@sha256:4968f22d0c6c10ef29952f3e807f62872ba22b3312f25803564fbfc08255efc2",
    architectures: ["amd64", "arm64"],
    majorVersion: 8,
  },
  redis: {
    image:
      "redis:8-alpine@sha256:becdda6c7f4b3fb42e42fd7f120bbf5c54c4caaaf16f26da24e4563d2c1f0576",
    architectures: ["amd64", "arm64"],
    majorVersion: 8,
  },
  dragonfly: {
    image:
      "docker.dragonflydb.io/dragonflydb/dragonfly:v1.33.1@sha256:de1a932e51bf50d96bb8bee1b5bde96b429de38e3cab369238aeec3a93f5fdba",
    architectures: ["amd64", "arm64"],
    majorVersion: 1,
  },
  keydb: {
    image:
      "eqalpha/keydb:x86_64_v6.3.4@sha256:eceb1806730c7850395b8262300182c2e15a6e5dacbf0b72cbab110518caf43f",
    architectures: ["amd64"],
    majorVersion: 6,
  },
  clickhouse: {
    image:
      "clickhouse/clickhouse-server:25.8-alpine@sha256:87e0a5b72f5465b18eacca7c76850e7ff551c9795c50e451f5646299e5e24146",
    architectures: ["amd64", "arm64"],
    majorVersion: 25,
  },
} as const satisfies Record<
  ManagedResourceType,
  {
    image: string;
    architectures: readonly ("amd64" | "arm64")[];
    majorVersion: number;
  }
>;
const sshUsernamePattern = /^[a-z_][a-z0-9_-]{0,31}$/i;
const branchSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(isValidBranchName, "Expected a valid Git branch name");
const hookArgumentSchema = z
  .string()
  .min(1)
  .max(4_096)
  .refine(
    (value) => !value.includes("\0"),
    "Hook arguments cannot contain null bytes",
  );

const repositoryPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(1_024)
  .superRefine((value, context) => {
    try {
      normalizeRepositoryPath(value);
    } catch (error) {
      context.addIssue({
        code: "custom",
        message:
          error instanceof Error ? error.message : "Invalid repository path",
      });
    }
  });

const deploymentInputPatternSchema = z
  .string()
  .trim()
  .min(1)
  .max(1_024)
  .superRefine((value, context) => {
    if (value.startsWith("$")) {
      if (!deploymentInputGroupPattern.test(value.slice(1))) {
        context.addIssue({
          code: "custom",
          message:
            "Expected a deployment input group reference such as $shared-web",
        });
      }
      return;
    }
    if (
      value.startsWith("!") ||
      value.includes("\\") ||
      value.includes("\0") ||
      path.posix.isAbsolute(value)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Deployment input patterns must be relative, additive repository globs",
      });
      return;
    }
    if (value.split("/").includes("..")) {
      context.addIssue({
        code: "custom",
        message: "Deployment input patterns cannot contain parent segments",
      });
    }
  });

const deploymentInputGlobSchema = deploymentInputPatternSchema.refine(
  (value) => !value.startsWith("$"),
  "Root deployment input groups must contain repository globs, not group references",
);

const appAutoDeploySchema = z.union([
  z.boolean(),
  z
    .object({
      inputs: z.array(deploymentInputPatternSchema).min(1).max(200),
    })
    .strict(),
]);

const domainSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .superRefine((value, context) => {
    try {
      normalizeDomain(value);
    } catch (error) {
      context.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "Invalid domain",
      });
    }
  });

export const ipAddressSchema = z
  .string()
  .trim()
  .refine((value) => isIP(value) !== 0, "Expected an IPv4 or IPv6 address");

const serverReferenceSchema = ipAddressSchema;

const redirectSchema = z
  .object({
    host: domainSchema,
    status: z.union([z.literal(301), z.literal(302)]).optional(),
  })
  .strict();

export const serverConfigurationSchema = z
  .object({
    buildConcurrency: z.number().int().min(1).max(16).optional(),
    previewBuildConcurrency: z.number().int().min(1).max(4).optional(),
    ip: ipAddressSchema,
    ssh: z
      .object({
        host: ipAddressSchema.optional(),
        username: z.string().trim().regex(sshUsernamePattern),
        port: z.number().int().min(1).max(65_535).optional(),
      })
      .strict(),
    proxy: z
      .object({
        cloudflare: z
          .object({
            enabled: z.literal(true),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const deploymentHookSchema = z
  .object({
    command: z.array(hookArgumentSchema).min(1).max(64),
    timeoutSeconds: z.number().int().min(5).max(1_800).optional(),
  })
  .strict();

const containerResourcesSchema = z
  .object({
    cpus: z.number().positive().max(128),
    memory: z.string().trim().regex(dockerMemoryPattern),
  })
  .strict();

const dockerVolumeSchema = z
  .object({
    name: z.string().trim().regex(dockerVolumePattern),
    mountPath: z
      .string()
      .trim()
      .min(1)
      .max(1_024)
      .refine(
        (value) =>
          value.startsWith("/") &&
          !value.split("/").some((segment) => segment === ".."),
        "Expected an absolute container path without parent traversal",
      ),
  })
  .strict();

export const appVolumeSchema = dockerVolumeSchema
  .extend({
    initialData: z.enum(["image", "previous-container"]).optional(),
  })
  .superRefine((volume, context) => {
    const value = volume.mountPath;
    if (
      !/^\/[a-zA-Z0-9_./-]+$/.test(value) ||
      value === "/" ||
      value.endsWith("/") ||
      value
        .split("/")
        .slice(1)
        .some((part) => !part || part === ".") ||
      ["/proc", "/sys", "/dev", "/etc", "/run", "/var/run"].some(
        (root) => value === root || value.startsWith(`${root}/`),
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["mountPath"],
        message:
          "Use a canonical application data directory, such as /app/uploads or /data",
      });
    }
  });
export type AppVolume = z.infer<typeof appVolumeSchema>;

const resourceHealthSchema = z
  .object({
    type: z.enum(["command", "container", "http"]),
    path: z.string().trim().startsWith("/").max(1_024).optional(),
    command: z.array(hookArgumentSchema).min(1).max(64).optional(),
    timeoutSeconds: z.number().int().min(5).max(600).optional(),
  })
  .strict()
  .superRefine((health, context) => {
    if (health.type === "http" && !health.path) {
      context.addIssue({
        code: "custom",
        message: "HTTP health checks require a path",
        path: ["path"],
      });
    }
    if (health.type === "command" && !health.command) {
      context.addIssue({
        code: "custom",
        message: "Command health checks require a command",
        path: ["command"],
      });
    }
    if (health.type !== "http" && health.path) {
      context.addIssue({
        code: "custom",
        message: "Only HTTP health checks accept a path",
        path: ["path"],
      });
    }
    if (health.type !== "command" && health.command) {
      context.addIssue({
        code: "custom",
        message: "Only command health checks accept a command",
        path: ["command"],
      });
    }
  });

const resourceAccessSchema = z
  .object({
    sshTunnel: z
      .object({
        hostPort: z.number().int().min(1_024).max(65_535),
      })
      .strict(),
  })
  .strict();

const backupPrefixSchema = z
  .string()
  .trim()
  .max(512)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.split("/").some((segment) => segment === ".."),
    "Backup prefix must be relative and cannot contain parent traversal",
  )
  .optional();

export const backupProviders = ["s3", "r2", "gcs"] as const;
export type BackupProvider = (typeof backupProviders)[number];
const legacyBackupProviders = ["s3", "gcs"] as const;

const resourceBackupS3Schema = z
  .object({
    bucket: z.string().trim().regex(s3BucketPattern),
    encryption: z.enum(["AES256", "aws:kms"]).optional(),
    kmsKeyId: z.string().trim().min(1).max(2_048).optional(),
    prefix: backupPrefixSchema,
    region: z.string().trim().min(1).max(64).optional(),
  })
  .strict()
  .superRefine((s3, context) => {
    if (s3.encryption === "aws:kms" && !s3.kmsKeyId) {
      context.addIssue({
        code: "custom",
        message: "AWS KMS backup encryption requires kmsKeyId",
        path: ["kmsKeyId"],
      });
    }
    if (s3.encryption !== "aws:kms" && s3.kmsKeyId) {
      context.addIssue({
        code: "custom",
        message: "kmsKeyId is only valid with aws:kms encryption",
        path: ["kmsKeyId"],
      });
    }
  });

const resourceBackupGcsSchema = z
  .object({
    bucket: z.string().trim().regex(gcsBucketPattern),
    prefix: backupPrefixSchema,
    region: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

const resourceBackupSchema = z
  .object({
    integration: integrationReferenceSchema.optional(),
    gcs: resourceBackupGcsSchema.optional(),
    restoreFrom: z.enum(legacyBackupProviders).optional(),
    retention: z
      .object({ keepLast: z.number().int().min(1).max(100).optional() })
      .strict()
      .optional(),
    s3: resourceBackupS3Schema.optional(),
    schedule: z
      .object({
        cron: z.string().trim().min(1).max(120),
        timezone: z.literal("UTC").optional(),
      })
      .strict()
      .superRefine((schedule, context) => {
        try {
          validateBackupCron(schedule.cron);
        } catch (error) {
          context.addIssue({
            code: "custom",
            message:
              error instanceof Error
                ? error.message
                : "Invalid backup cron expression",
            path: ["cron"],
          });
        }
      })
      .optional(),
  })
  .strict()
  .superRefine((backup, context) => {
    const destinations = (
      [backup.s3 && "s3", backup.gcs && "gcs"] as const
    ).filter((value): value is (typeof legacyBackupProviders)[number] =>
      Boolean(value),
    );
    if (backup.integration && destinations.length > 0) {
      context.addIssue({
        code: "custom",
        message:
          "A named backup integration cannot be combined with legacy provider destinations",
        path: ["integration"],
      });
    }
    if (!backup.integration && destinations.length === 0) {
      context.addIssue({
        code: "custom",
        message: "A named backup integration is required",
        path: [],
      });
    }
    if (backup.integration && backup.restoreFrom) {
      context.addIssue({
        code: "custom",
        message: "restoreFrom is derived from the named backup integration",
        path: ["restoreFrom"],
      });
    }
    if (!backup.integration && destinations.length > 1 && !backup.restoreFrom) {
      context.addIssue({
        code: "custom",
        message:
          "restoreFrom is required when multiple backup destinations are declared",
        path: ["restoreFrom"],
      });
    }
    if (
      !backup.integration &&
      backup.restoreFrom &&
      !destinations.includes(backup.restoreFrom)
    ) {
      context.addIssue({
        code: "custom",
        message: `restoreFrom '${backup.restoreFrom}' must reference a declared backup destination`,
        path: ["restoreFrom"],
      });
    }
  });

export const appSchema = z
  .object({
    jobs: z.array(appJobSchema).max(20).optional(),
    notifications: manifestNotificationsSchema.optional(),
    autoDeploy: appAutoDeploySchema.optional(),
    vulnerabilityScanning: z.boolean().optional(),
    id: z.string().trim().regex(appIdPattern),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).optional(),
    server: serverReferenceSchema,
    deployment: appDeploymentSchema.optional(),
    dockerfile: repositoryPathSchema.optional(),
    context: repositoryPathSchema.optional(),
    buildServer: buildServerSelectionSchema.nullable().optional(),
    rollout: rolloutStrategySchema.optional(),
    externalSecrets: z
      .record(z.string().trim().min(1).max(256), externalSecretReferenceSchema)
      .optional(),
    ingress: ingressSchema.optional(),
    container: z
      .object({
        network: z.string().trim().regex(dockerNetworkPattern).optional(),
        networkAlias: z.string().trim().regex(appIdPattern).optional(),
        port: z.number().int().min(1).max(65_535),
        volumes: z.array(appVolumeSchema).max(20).optional(),
        resources: containerResourcesSchema.optional(),
      })
      .strict(),
    health: z
      .object({
        path: z.string().trim().startsWith("/").max(1_024),
        timeoutSeconds: z.number().int().min(5).max(600).optional(),
      })
      .strict()
      .optional(),
    hooks: z
      .object({
        postDeploy: deploymentHookSchema.optional(),
        preDeploy: deploymentHookSchema.optional(),
      })
      .strict()
      .refine((hooks) => hooks.preDeploy || hooks.postDeploy, {
        message: "At least one deployment hook is required",
      })
      .optional(),
    domains: z
      .object({
        primary: domainSchema,
        redirects: z.array(redirectSchema).max(20).optional(),
      })
      .strict()
      .optional(),
    tls: z
      .object({
        mode: z.enum(["direct", "cloudflare-dns"]),
      })
      .strict()
      .optional(),
    preview: z
      .object({
        domain: domainSchema,
        enabled: z.literal(true),
        ttlHours: z.number().int().min(1).max(720).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  // eslint-disable-next-line complexity -- The refinement is a declarative list of independent manifest invariants.
  .superRefine((app, context) => {
    if (!app.deployment && !app.dockerfile) {
      context.addIssue({
        code: "custom",
        path: ["deployment"],
        message: "Declare an explicit deployment type",
      });
    }
    if (app.deployment && (app.dockerfile || app.context)) {
      context.addIssue({
        code: "custom",
        path: ["deployment"],
        message:
          "Deployment-specific fields belong inside deployment; do not combine them with legacy dockerfile/context fields",
      });
    }
    if (app.deployment?.type === "image" && app.buildServer) {
      context.addIssue({
        code: "custom",
        path: ["buildServer"],
        message: "Prebuilt image deployments do not use a build server",
      });
    }
    const externalBuildSecrets = Object.entries(
      app.externalSecrets ?? {},
    ).filter(([, reference]) => reference.use === "build");
    const buildSecretsSupported =
      !app.deployment ||
      app.deployment.type === "dockerfile" ||
      app.deployment.type === "static";
    if (externalBuildSecrets.length > 0 && !buildSecretsSupported) {
      const deploymentType = app.deployment?.type ?? "unknown";
      for (const [name] of externalBuildSecrets) {
        context.addIssue({
          code: "custom",
          path: ["externalSecrets", name, "use"],
          message:
            deploymentType === "image"
              ? "Prebuilt image deployments do not run a build and cannot use build secrets"
              : `${deploymentType} builds do not support secret-safe build mounts; use runtime or a Dockerfile/static build`,
        });
      }
    }
    findDuplicates((app.jobs ?? []).map((job) => job.name)).forEach((name) =>
      context.addIssue({
        code: "custom",
        path: ["jobs"],
        message: `Job name '${name}' is declared more than once`,
      }),
    );
    const volumes = app.container.volumes ?? [];
    for (const [index, volume] of volumes.entries()) {
      if (
        volumes
          .slice(0, index)
          .some(
            (other) =>
              other.name === volume.name ||
              other.mountPath === volume.mountPath ||
              other.mountPath.startsWith(`${volume.mountPath}/`) ||
              volume.mountPath.startsWith(`${other.mountPath}/`),
          )
      ) {
        context.addIssue({
          code: "custom",
          path: ["container", "volumes", index],
          message:
            "Volume names must be unique and mount paths must not overlap",
        });
      }
    }
    const dockerfileDeployment =
      app.deployment?.type === "dockerfile"
        ? app.deployment
        : app.dockerfile
          ? {
              type: "dockerfile" as const,
              context: app.context ?? ".",
              dockerfile: app.dockerfile,
              timeoutSeconds: 2_700,
            }
          : undefined;
    if (dockerfileDeployment) {
      let normalizedContext: string;
      let normalizedDockerfile: string;
      try {
        normalizedContext = normalizeRepositoryPath(
          dockerfileDeployment.context,
        );
        normalizedDockerfile = normalizeRepositoryPath(
          dockerfileDeployment.dockerfile,
        );
      } catch {
        // The field-level validators already recorded the precise path issue.
        return;
      }
      const relativeDockerfile = path.posix.relative(
        normalizedContext,
        normalizedDockerfile,
      );
      if (
        relativeDockerfile === ".." ||
        relativeDockerfile.startsWith("../") ||
        path.posix.isAbsolute(relativeDockerfile)
      ) {
        context.addIssue({
          code: "custom",
          message: "Dockerfile must be inside the declared build context",
          path: app.deployment ? ["deployment", "dockerfile"] : ["dockerfile"],
        });
      }
    }

    if (
      app.rollout?.type === "rolling" &&
      (app.container.volumes?.length ?? 0) > 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["rollout"],
        message:
          "Rolling deployment is unavailable for apps with single-writer managed volumes; use recreate with an impact reason",
      });
    }
    if (app.rollout?.type === "rolling" && app.container.networkAlias) {
      context.addIssue({
        code: "custom",
        path: ["rollout"],
        message:
          "Rolling deployment is unavailable for singleton network aliases; use recreate with an impact reason",
      });
    }
    if (
      app.rollout?.type === "recreate" &&
      ((app.container.volumes?.length ?? 0) > 0 ||
        Boolean(app.container.networkAlias)) &&
      !app.rollout.maintenanceMode
    ) {
      context.addIssue({
        code: "custom",
        path: ["rollout", "maintenanceMode"],
        message:
          "Apps with single-writer volumes or singleton network aliases must enable maintenance mode so the previous release stops before replacement",
      });
    }
    if (app.container.networkAlias && !app.container.network) {
      context.addIssue({
        code: "custom",
        message: "A network alias requires a Docker network",
        path: ["container", "networkAlias"],
      });
    }
    if (app.container.networkAlias && app.preview) {
      context.addIssue({
        code: "custom",
        message:
          "Apps with a stable network alias cannot enable Preview deployments",
        path: ["preview"],
      });
    }
    if (app.tls && !app.domains) {
      context.addIssue({
        code: "custom",
        message: "TLS configuration requires a primary domain",
        path: ["tls"],
      });
    }
    if (app.ingress?.type === "cloudflare-tunnel" && !app.domains) {
      context.addIssue({
        code: "custom",
        message: "Cloudflare Tunnel ingress requires a primary domain",
        path: ["ingress"],
      });
    }
    if (app.preview && !app.domains) {
      context.addIssue({
        code: "custom",
        message:
          "Preview deployments require production domains and TLS configuration",
        path: ["preview", "domain"],
      });
    }
    if (app.preview && !app.tls) {
      context.addIssue({
        code: "custom",
        message: "Preview deployments require TLS configuration",
        path: ["preview", "domain"],
      });
    }
  });

function validateResourceBackupSupport(
  resource: {
    backup?: unknown;
    container?: { volumes?: Array<{ mountPath: string; name: string }> };
    image?: string;
    type: ResourceType;
  },
  context: z.RefinementCtx,
) {
  if (!resource.backup) return;
  if (resource.type === "image") {
    context.addIssue({
      code: "custom",
      message: "Managed backups are unavailable for generic image resources",
      path: ["backup"],
    });
    return;
  }
  const image = resource.image ?? defaultResourceImage(resource.type)!;
  const defaultVolume = defaultResourceVolume(resource.type, image)!;
  const declared = resource.container?.volumes ?? [];
  const effectiveVolumes = declared.some(
    (volume) => volume.mountPath === defaultVolume.mountPath,
  )
    ? declared
    : [defaultVolume, ...declared];
  if (effectiveVolumes.length !== 1)
    context.addIssue({
      code: "custom",
      message:
        "Managed database backup and restore supports only the engine data volume",
      path: ["container", "volumes"],
    });
}

function validateResourceImageAndCommand(
  resource: {
    container?: { command?: string[] };
    image?: string;
    type: ResourceType;
  },
  context: z.RefinementCtx,
) {
  const image = resource.image ?? defaultResourceImage(resource.type);
  if (!image) {
    context.addIssue({
      code: "custom",
      message: "Image resources require an image",
      path: ["image"],
    });
  } else if (!hasImmutableImageSelector(image)) {
    context.addIssue({
      code: "custom",
      message: "Resource images require an explicit non-latest tag or digest",
      path: ["image"],
    });
  }
  if (resource.type !== "image" && resource.container?.command) {
    context.addIssue({
      code: "custom",
      message: `${resource.type} resources use Towbar's managed command`,
      path: ["container", "command"],
    });
  }
}

function validateManagedResourceImage(
  resource: { image?: string; type: ResourceType },
  context: z.RefinementCtx,
) {
  if (resource.type === "image" || !resource.image) return;
  if (!/@sha256:[a-f0-9]{64}$/u.test(resource.image)) {
    context.addIssue({
      code: "custom",
      message:
        "Custom managed database images must include an immutable sha256 digest",
      path: ["image"],
    });
    return;
  }
  const taggedReference = resource.image.split("@")[0]!;
  const tag = taggedReference.slice(taggedReference.lastIndexOf(":") + 1);
  const match = /v?(\d+)(?:[.-]|$)/u.exec(tag);
  const supported = managedResourceCompatibility[resource.type].majorVersion;
  if (!match || Number(match[1]) !== supported) {
    context.addIssue({
      code: "custom",
      message: `${resource.type} images must declare supported major version ${supported} in the tag`,
      path: ["image"],
    });
  }
}

function validateResourceConnectivity(
  resource: {
    access?: { sshTunnel: { hostPort: number } };
    container?: { network?: string; networkAlias?: string; port?: number };
    type: ResourceType;
  },
  context: z.RefinementCtx,
) {
  if (resource.container?.networkAlias && !resource.container.network) {
    context.addIssue({
      code: "custom",
      message: "A network alias requires a declared Docker network",
      path: ["container", "networkAlias"],
    });
  }
  const port = resource.container?.port ?? defaultResourcePort(resource.type);
  if (resource.access?.sshTunnel && !port) {
    context.addIssue({
      code: "custom",
      message: "SSH tunnel access requires a container port",
      path: ["access", "sshTunnel", "hostPort"],
    });
  }
}

export const resourceSchema = z
  .object({
    access: resourceAccessSchema.optional(),
    autoDeploy: z.boolean().optional(),
    backup: resourceBackupSchema.optional(),
    notifications: manifestNotificationsSchema.optional(),
    externalSecrets: z
      .record(z.string().trim().min(1).max(256), externalSecretReferenceSchema)
      .optional(),
    ingress: ingressSchema.optional(),
    id: z.string().trim().regex(appIdPattern),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).optional(),
    type: z.enum(["image", ...managedResourceTypes]),
    image: z.string().trim().regex(dockerImagePattern).optional(),
    server: serverReferenceSchema,
    container: z
      .object({
        command: z.array(hookArgumentSchema).min(1).max(64).optional(),
        network: z.string().trim().regex(dockerNetworkPattern).optional(),
        networkAlias: z.string().trim().regex(appIdPattern).optional(),
        port: z.number().int().min(1).max(65_535).optional(),
        resources: containerResourcesSchema.optional(),
        volumes: z.array(dockerVolumeSchema).max(20).optional(),
      })
      .strict()
      .optional(),
    health: resourceHealthSchema.optional(),
    domains: z
      .object({
        primary: domainSchema,
        redirects: z.array(redirectSchema).max(20).optional(),
      })
      .strict()
      .optional(),
    tls: z
      .object({ mode: z.enum(["direct", "cloudflare-dns"]) })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((resource, context) => {
    validateResourceImageAndCommand(resource, context);
    validateManagedResourceImage(resource, context);
    validateResourceConnectivity(resource, context);
    validateResourceBackupSupport(resource, context);
    for (const [name, reference] of Object.entries(
      resource.externalSecrets ?? {},
    )) {
      if (reference.use === "build") {
        context.addIssue({
          code: "custom",
          message:
            "Resources do not run source builds and only support runtime external secrets",
          path: ["externalSecrets", name, "use"],
        });
      }
    }
    const volumes = resource.container?.volumes ?? [];
    findDuplicates(volumes.map((volume) => volume.name)).forEach((name) =>
      context.addIssue({
        code: "custom",
        message: `Volume '${name}' is declared more than once`,
        path: ["container", "volumes"],
      }),
    );
    findDuplicates(volumes.map((volume) => volume.mountPath)).forEach(
      (mountPath) =>
        context.addIssue({
          code: "custom",
          message: `Volume mount '${mountPath}' is declared more than once`,
          path: ["container", "volumes"],
        }),
    );
    const port = resource.container?.port ?? defaultResourcePort(resource.type);
    if (resource.domains && !port) {
      context.addIssue({
        code: "custom",
        message: "Domains require a container port",
        path: ["container", "port"],
      });
    }
    const effectiveHealthType =
      resource.health?.type ??
      (resource.type === "image" && port ? "http" : "command");
    if (resource.domains && effectiveHealthType !== "http") {
      context.addIssue({
        code: "custom",
        message: "Public resources require an HTTP health check",
        path: ["health", "type"],
      });
    }
    if (resource.health?.type === "http" && !port) {
      context.addIssue({
        code: "custom",
        message: "HTTP health checks require a container port",
        path: ["container", "port"],
      });
    }
    if (resource.tls && !resource.domains) {
      context.addIssue({
        code: "custom",
        message: "TLS configuration requires a primary domain",
        path: ["tls"],
      });
    }
    if (resource.ingress?.type === "cloudflare-tunnel" && !resource.domains) {
      context.addIssue({
        code: "custom",
        message: "Cloudflare Tunnel ingress requires a primary domain",
        path: ["ingress"],
      });
    }
  });

export const resolvedDeploymentManifestSchema = z
  .object({
    version: z.literal(2),
    defaults: z
      .object({
        buildServer: buildServerSelectionSchema.optional(),
      })
      .strict()
      .optional(),
    deploymentInputs: z
      .record(
        z.string().regex(deploymentInputGroupPattern),
        z.array(deploymentInputGlobSchema).min(1).max(200),
      )
      .optional(),
    source: z
      .object({
        branch: branchSchema.optional(),
      })
      .strict()
      .optional(),
    apps: z.array(appSchema).max(500).optional(),
    compose: z.array(composeWorkloadSchema).max(100).optional(),
    resources: z.array(resourceSchema).max(500).optional(),
  })
  .strict()
  .superRefine((manifest, context) => {
    const deployables = [
      ...(manifest.apps ?? []),
      ...(manifest.resources ?? []),
    ];
    findDuplicates([
      ...(manifest.apps ?? []).map((app) => `app:${app.id}`),
      ...(manifest.resources ?? []).map(
        (resource) => `resource:${resource.id}`,
      ),
      ...(manifest.compose ?? []).map((workload) => `compose:${workload.id}`),
    ]).forEach((id) =>
      context.addIssue({
        code: "custom",
        message: `Deployable id '${id}' is declared more than once`,
        path: [],
      }),
    );

    const claimedDomains = new Map<string, string>();
    const claimedNetworkAliases = new Map<string, string>();
    const claimedSshTunnelPorts = new Map<string, string>();

    (manifest.apps ?? []).forEach((app, appIndex) => {
      const { network, networkAlias } = app.container;
      if (!network || !networkAlias) return;
      const key = `${canonicalIp(app.server)}\u0000${network}\u0000${networkAlias}`;
      const owner = claimedNetworkAliases.get(key);
      if (owner) {
        context.addIssue({
          code: "custom",
          message: `Network alias '${networkAlias}' is already claimed by deployable '${owner}' on this server and network`,
          path: ["apps", appIndex, "container", "networkAlias"],
        });
      } else {
        claimedNetworkAliases.set(key, app.id);
      }
    });

    (manifest.resources ?? []).forEach((resource, resourceIndex) => {
      const serverIp = canonicalIp(resource.server);
      const network = resource.container?.network;
      if (network) {
        const alias = resource.container?.networkAlias ?? resource.id;
        const key = `${serverIp}\u0000${network}\u0000${alias}`;
        const owner = claimedNetworkAliases.get(key);
        if (owner) {
          context.addIssue({
            code: "custom",
            message: `Network alias '${alias}' is already claimed by deployable '${owner}' on this server and network`,
            path: ["resources", resourceIndex, "container", "networkAlias"],
          });
        } else {
          claimedNetworkAliases.set(key, resource.id);
        }
      }

      const hostPort = resource.access?.sshTunnel.hostPort;
      if (hostPort) {
        const key = `${serverIp}\u0000${hostPort}`;
        const owner = claimedSshTunnelPorts.get(key);
        if (owner) {
          context.addIssue({
            code: "custom",
            message: `SSH tunnel host port '${hostPort}' is already claimed by resource '${owner}' on this server`,
            path: [
              "resources",
              resourceIndex,
              "access",
              "sshTunnel",
              "hostPort",
            ],
          });
        } else {
          claimedSshTunnelPorts.set(key, resource.id);
        }
      }
    });

    Object.entries(manifest.deploymentInputs ?? {}).forEach(
      ([group, inputs]) => {
        findDuplicates(inputs).forEach((input) =>
          context.addIssue({
            code: "custom",
            message: `Deployment input '${input}' is declared more than once`,
            path: ["deploymentInputs", group],
          }),
        );
      },
    );

    (manifest.apps ?? []).forEach((app, appIndex) => {
      if (typeof app.autoDeploy !== "object") return;
      findDuplicates(app.autoDeploy.inputs).forEach((input) =>
        context.addIssue({
          code: "custom",
          message: `Deployment input '${input}' is declared more than once`,
          path: ["apps", appIndex, "autoDeploy", "inputs"],
        }),
      );
      app.autoDeploy.inputs.forEach((input, inputIndex) => {
        if (
          input.startsWith("$") &&
          !manifest.deploymentInputs?.[input.slice(1)]
        ) {
          context.addIssue({
            code: "custom",
            message: `Deployment input group '${input}' is not declared`,
            path: ["apps", appIndex, "autoDeploy", "inputs", inputIndex],
          });
        }
      });
    });

    deployables.forEach((app, appIndex) => {
      const collection = "type" in app ? "resources" : "apps";
      if (!app.domains) return;
      const domains = [
        app.domains.primary,
        ...(app.domains.redirects ?? []).map((redirect) => redirect.host),
      ];
      domains.forEach((value) => {
        const domain = normalizeDomain(value);
        const owner = claimedDomains.get(domain);
        if (owner) {
          context.addIssue({
            code: "custom",
            message: `Domain '${domain}' is already claimed by app '${owner}'`,
            path: [collection, appIndex, "domains"],
          });
          return;
        }
        claimedDomains.set(domain, app.id);
      });
    });
    (manifest.compose ?? []).forEach((workload, workloadIndex) => {
      Object.entries(workload.services).forEach(([service, policy]) => {
        (policy.domains ?? []).forEach((value) => {
          const domain = normalizeDomain(value);
          const owner = claimedDomains.get(domain);
          if (owner) {
            context.addIssue({
              code: "custom",
              message: `Domain '${domain}' is already claimed by deployable '${owner}'`,
              path: ["compose", workloadIndex, "services", service, "domains"],
            });
          } else claimedDomains.set(domain, `${workload.id}/${service}`);
        });
      });
    });
  });

export type DeploymentManifestInput = z.input<
  typeof resolvedDeploymentManifestSchema
>;

export type NormalizedServer = {
  buildConcurrency: number;
  previewBuildConcurrency?: number;
  ip: string;
  proxy?: {
    cloudflare: {
      enabled: true;
    };
  };
  ssh: { host: string; port: number; username: string };
};

export type NormalizedDeploymentHook = {
  command: string[];
  timeoutSeconds: number;
};

export type NormalizedApp = {
  notifications?: ManifestNotifications;
  jobs?: AppJob[];
  kind?: "app";
  autoDeploy: boolean;
  vulnerabilityScanning: boolean;
  container: {
    network?: string;
    networkAlias?: string;
    port: number;
    volumes?: AppVolume[];
    resources?: { cpus: number; memory: string };
  };
  buildServer?: z.infer<typeof buildServerSelectionSchema>;
  context: string;
  deployment?: AppDeployment;
  deploymentInputs: string[];
  description?: string;
  dockerfile?: string;
  domains?: {
    primary: string;
    redirects: Array<{ host: string; status: 301 | 302 }>;
  };
  health: { path: string; timeoutSeconds: number };
  hooks: {
    postDeploy?: NormalizedDeploymentHook;
    preDeploy?: NormalizedDeploymentHook;
  };
  id: string;
  name: string;
  preview?: {
    domain: string;
    enabled: true;
    ttlHours: number;
  };
  externalSecrets?: Record<
    string,
    z.infer<typeof externalSecretReferenceSchema>
  >;
  ingress?: z.infer<typeof ingressSchema>;
  rollout?: z.infer<typeof rolloutStrategySchema>;
  server: string;
  sourceBranch: string;
  tls?: { mode: "direct" | "cloudflare-dns" };
};

export type NormalizedResource = {
  notifications?: ManifestNotifications;
  externalSecrets?: Record<
    string,
    z.infer<typeof externalSecretReferenceSchema>
  >;
  ingress?: z.infer<typeof ingressSchema>;
  access?: {
    sshTunnel: { hostPort: number };
  };
  autoDeploy: boolean;
  backup?: {
    integration?: string;
    gcs?: {
      bucket: string;
      prefix: string;
      region?: string;
    };
    restoreFrom?: "s3" | "gcs";
    retention: { keepLast: number };
    s3?: {
      bucket: string;
      encryption: "AES256" | "aws:kms";
      kmsKeyId?: string;
      prefix: string;
      region?: string;
    };
    schedule?: { cron: string; timezone: "UTC" };
  };
  container: {
    command: string[];
    network?: string;
    networkAlias?: string;
    port?: number;
    resources: { cpus: number; memory: string };
    volumes: Array<{ mountPath: string; name: string }>;
  };
  description?: string;
  domains?: NormalizedApp["domains"];
  health:
    | { command: string[]; timeoutSeconds: number; type: "command" }
    | { timeoutSeconds: number; type: "container" }
    | { path: string; timeoutSeconds: number; type: "http" };
  id: string;
  image: string;
  kind: ResourceType;
  name: string;
  server: string;
  sourceBranch: string;
  tls?: { mode: "direct" | "cloudflare-dns" };
};

export type NormalizedComposeWorkload = ComposeWorkload & {
  container: {
    network?: string;
    networkAlias?: string;
    port: number;
    resources?: { cpus: number; memory: string };
    volumes: [];
  };
  context: string;
  deployment?: never;
  deploymentInputs: string[];
  domains?: NormalizedApp["domains"];
  health: NormalizedApp["health"];
  hooks: NormalizedApp["hooks"];
  ingress?: never;
  kind: "compose";
  jobs?: NormalizedApp["jobs"];
  preview?: NormalizedApp["preview"];
  sourceBranch: string;
  tls?: NormalizedApp["tls"];
  vulnerabilityScanning: boolean;
};

export type NormalizedDeployable =
  NormalizedApp | NormalizedComposeWorkload | NormalizedResource;

export type NormalizedDeploymentManifest = {
  apps: NormalizedApp[];
  compose?: NormalizedComposeWorkload[];
  resources?: NormalizedResource[];
  source: { branch: string };
  version: 2;
};

export type ManifestIssue = {
  column?: number;
  line?: number;
  message: string;
  path: Array<number | string>;
};

export class ManifestValidationError extends Error {
  readonly issues: ManifestIssue[];

  constructor(issues: ManifestIssue[]) {
    super("Towbar deployment manifest is invalid");
    this.name = "ManifestValidationError";
    this.issues = issues;
  }
}

export function normalizeDeploymentManifest(
  manifest: DeploymentManifestInput,
): NormalizedDeploymentManifest {
  const parsed = resolvedDeploymentManifestSchema.parse(manifest);
  const sourceBranch = parsed.source?.branch ?? "main";
  return {
    version: parsed.version,
    source: { branch: sourceBranch },
    apps: (parsed.apps ?? [])
      // eslint-disable-next-line complexity -- Normalization handles every optional app capability in one canonical pass.
      .map((app) => {
        const deployment = normalizeAppDeployment(app);
        const buildServer =
          deployment.type === "image" || app.buildServer === null
            ? undefined
            : (app.buildServer ?? parsed.defaults?.buildServer);
        const automaticDeployment = normalizeAutomaticDeployment(
          app.autoDeploy,
          parsed.deploymentInputs,
        );
        return {
          kind: "app" as const,
          ...(app.notifications
            ? {
                notifications: normalizeManifestNotifications(
                  app.notifications,
                ),
              }
            : {}),
          ...(app.jobs?.length
            ? {
                jobs: [...app.jobs].sort((a, b) =>
                  a.name.localeCompare(b.name),
                ),
              }
            : {}),
          autoDeploy: automaticDeployment.enabled,
          vulnerabilityScanning: app.vulnerabilityScanning ?? false,
          id: app.id,
          name: app.name,
          ...(app.description ? { description: app.description } : {}),
          server: canonicalIp(app.server),
          sourceBranch,
          deployment,
          ...(deployment.type === "dockerfile"
            ? { dockerfile: deployment.dockerfile }
            : {}),
          context:
            "context" in deployment
              ? normalizeRepositoryPath(deployment.context)
              : ".",
          ...(buildServer
            ? {
                buildServer: {
                  ...buildServer,
                  ip: canonicalIp(buildServer.ip),
                },
              }
            : {}),
          rollout: app.rollout ?? rolloutStrategySchema.parse(undefined),
          ...(app.externalSecrets
            ? { externalSecrets: app.externalSecrets }
            : {}),
          ...(app.ingress ? { ingress: app.ingress } : {}),
          deploymentInputs: automaticDeployment.inputs,
          container: {
            ...(app.container.network
              ? { network: app.container.network.trim() }
              : {}),
            ...(app.container.networkAlias
              ? { networkAlias: app.container.networkAlias.trim() }
              : {}),
            port: app.container.port,
            ...(app.container.volumes?.length
              ? {
                  volumes: app.container.volumes
                    .map((volume) => ({ ...volume }))
                    .sort((a, b) => a.name.localeCompare(b.name)),
                }
              : {}),
            ...(app.container.resources
              ? {
                  resources: {
                    cpus: app.container.resources.cpus,
                    memory: app.container.resources.memory.toLowerCase(),
                  },
                }
              : {}),
          },
          health: {
            path: app.health?.path ?? "/api/health",
            timeoutSeconds: app.health?.timeoutSeconds ?? 60,
          },
          hooks: {
            ...(app.hooks?.postDeploy
              ? { postDeploy: normalizeDeploymentHook(app.hooks.postDeploy) }
              : {}),
            ...(app.hooks?.preDeploy
              ? { preDeploy: normalizeDeploymentHook(app.hooks.preDeploy) }
              : {}),
          },
          ...normalizePreviewConfig(app.preview),
          ...(app.domains
            ? {
                domains: {
                  primary: normalizeDomain(app.domains.primary),
                  redirects: (app.domains.redirects ?? [])
                    .map((redirect) => ({
                      host: normalizeDomain(redirect.host),
                      status: redirect.status ?? 301,
                    }))
                    .sort((left, right) => left.host.localeCompare(right.host)),
                },
              }
            : {}),
          ...(app.tls ? { tls: app.tls } : {}),
        };
      })
      .sort((left, right) => left.id.localeCompare(right.id)),
    ...(parsed.compose?.length
      ? {
          compose: [...parsed.compose]
            .map((workload) => ({
              ...workload,
              ...(workload.notifications
                ? {
                    notifications: normalizeManifestNotifications(
                      workload.notifications,
                    ),
                  }
                : {}),
              container: { port: 0 as const, volumes: [] as [] },
              context: ".",
              deploymentInputs: [workload.file, ...workload.overrides],
              health: { path: "/", timeoutSeconds: 300 },
              hooks: {},
              kind: "compose" as const,
              sourceBranch,
              vulnerabilityScanning: false,
              server: canonicalIp(workload.server),
            }))
            .sort((left, right) => left.id.localeCompare(right.id)),
        }
      : {}),
    resources: (parsed.resources ?? [])
      .map((resource) => normalizeResource(resource, sourceBranch))
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function normalizeAppDeployment(
  app: z.output<typeof appSchema>,
): AppDeployment {
  if (app.deployment) return app.deployment;
  return appDeploymentSchema.parse({
    type: "dockerfile",
    context: app.context ?? ".",
    dockerfile: app.dockerfile,
  });
}

export function normalizeServerConfiguration(
  input: z.input<typeof serverConfigurationSchema>,
): NormalizedServer {
  const server = serverConfigurationSchema.parse(input);
  const buildConcurrency = server.buildConcurrency ?? 1;
  return {
    buildConcurrency,
    previewBuildConcurrency: Math.min(
      server.previewBuildConcurrency ?? 1,
      buildConcurrency,
    ),
    ip: canonicalIp(server.ip),
    ssh: {
      host: canonicalIp(server.ssh.host ?? server.ip),
      port: server.ssh.port ?? 22,
      username: server.ssh.username,
    },
    ...(server.proxy?.cloudflare
      ? {
          proxy: {
            cloudflare: {
              enabled: true as const,
            },
          },
        }
      : {}),
  };
}

function normalizeAutomaticDeployment(
  autoDeploy: z.output<typeof appAutoDeploySchema> | undefined,
  groups: Record<string, string[]> | undefined,
) {
  if (typeof autoDeploy !== "object") {
    return { enabled: autoDeploy ?? false, inputs: [] as string[] };
  }
  const inputs = autoDeploy.inputs.flatMap((input) =>
    input.startsWith("$") ? (groups?.[input.slice(1)] ?? []) : [input],
  );
  return {
    enabled: true,
    inputs: [...new Set(inputs.map(normalizeDeploymentInputPattern))].sort(),
  };
}

function normalizeDeploymentInputPattern(value: string) {
  return value.trim().replace(/^\.\//u, "");
}

export function isNormalizedResource(
  deployable: NormalizedDeployable,
): deployable is NormalizedResource {
  return (
    deployable.kind !== undefined &&
    deployable.kind !== "app" &&
    deployable.kind !== "compose"
  );
}

export function isNormalizedCompose(
  deployable: NormalizedDeployable,
): deployable is NormalizedComposeWorkload {
  return deployable.kind === "compose";
}

export function isNormalizedApp(
  deployable: NormalizedDeployable,
): deployable is NormalizedApp {
  return deployable.kind === "app";
}

function normalizeResource(
  resource: z.output<typeof resourceSchema>,
  sourceBranch: string,
): NormalizedResource {
  const kind = resource.type;
  const image = resource.image ?? defaultResourceImage(kind)!;
  const port = resource.container?.port ?? defaultResourcePort(kind);
  const defaultVolume = defaultResourceVolume(kind, image);
  const declaredVolumes = resource.container?.volumes ?? [];
  const volumes = defaultVolume
    ? declaredVolumes.some(
        (volume) => volume.mountPath === defaultVolume.mountPath,
      )
      ? declaredVolumes
      : [defaultVolume, ...declaredVolumes]
    : declaredVolumes;
  const health = normalizeResourceHealth(resource, port);
  const backup = normalizeResourceBackup(resource.backup);
  return {
    ...normalizeResourceAccess(resource.access),
    ...(resource.notifications
      ? {
          notifications: normalizeManifestNotifications(resource.notifications),
        }
      : {}),
    ...(resource.externalSecrets
      ? { externalSecrets: resource.externalSecrets }
      : {}),
    ...(resource.ingress ? { ingress: resource.ingress } : {}),
    autoDeploy: resource.autoDeploy ?? false,
    ...(backup ? { backup } : {}),
    container: normalizeResourceContainer(resource, kind, port, volumes),
    ...(resource.description ? { description: resource.description } : {}),
    ...(resource.domains
      ? {
          domains: {
            primary: normalizeDomain(resource.domains.primary),
            redirects: (resource.domains.redirects ?? [])
              .map((redirect) => ({
                host: normalizeDomain(redirect.host),
                status: redirect.status ?? 301,
              }))
              .sort((left, right) => left.host.localeCompare(right.host)),
          },
        }
      : {}),
    health,
    id: resource.id,
    image,
    kind,
    name: resource.name,
    server: canonicalIp(resource.server),
    sourceBranch,
    ...(resource.tls ? { tls: resource.tls } : {}),
  };
}

function normalizeResourceAccess(
  access: z.output<typeof resourceAccessSchema> | undefined,
) {
  if (!access) return {};
  return {
    access: {
      sshTunnel: {
        hostPort: access.sshTunnel.hostPort,
      },
    },
  };
}

function normalizeResourceContainer(
  resource: z.output<typeof resourceSchema>,
  kind: NormalizedResource["kind"],
  port: number | undefined,
  volumes: Array<{ mountPath: string; name: string }>,
): NormalizedResource["container"] {
  return {
    command:
      kind === "redis"
        ? [
            "sh",
            "-c",
            'exec redis-server --appendonly yes --requirepass "$REDIS_PASSWORD"',
          ]
        : kind === "dragonfly"
          ? [
              "sh",
              "-c",
              'exec dragonfly --dir=/data --dbfilename=dump.rdb --requirepass="$REDIS_PASSWORD"',
            ]
          : kind === "keydb"
            ? [
                "sh",
                "-c",
                'exec keydb-server --appendonly yes --requirepass "$REDIS_PASSWORD"',
              ]
            : [...(resource.container?.command ?? [])],
    ...(resource.container?.network
      ? {
          network: resource.container.network.trim(),
          networkAlias: resource.container.networkAlias?.trim() ?? resource.id,
        }
      : {}),
    ...(port ? { port } : {}),
    resources: resource.container?.resources
      ? {
          cpus: resource.container.resources.cpus,
          memory: resource.container.resources.memory.toLowerCase(),
        }
      : defaultResourceLimits(kind),
    volumes: volumes.map((volume) => ({ ...volume })),
  };
}

function normalizeResourceBackup(
  backup: z.output<typeof resourceBackupSchema> | undefined,
): NormalizedResource["backup"] {
  if (!backup) return undefined;
  const destinations = [backup.s3 && "s3", backup.gcs && "gcs"].filter(
    Boolean,
  ) as Array<"s3" | "gcs">;
  const restoreFrom = backup.integration
    ? undefined
    : (backup.restoreFrom ??
      (destinations.length === 1 ? destinations[0]! : "s3"));
  return {
    ...(backup.integration ? { integration: backup.integration } : {}),
    ...(backup.gcs
      ? {
          gcs: {
            bucket: backup.gcs.bucket,
            prefix: backup.gcs.prefix || "towbar",
            ...(backup.gcs.region ? { region: backup.gcs.region } : {}),
          },
        }
      : {}),
    ...(restoreFrom ? { restoreFrom } : {}),
    retention: { keepLast: backup.retention?.keepLast ?? 7 },
    ...(backup.s3
      ? {
          s3: {
            bucket: backup.s3.bucket,
            encryption: backup.s3.encryption ?? "AES256",
            ...(backup.s3.kmsKeyId ? { kmsKeyId: backup.s3.kmsKeyId } : {}),
            prefix: backup.s3.prefix || "towbar",
            ...(backup.s3.region ? { region: backup.s3.region } : {}),
          },
        }
      : {}),
    ...(backup.schedule
      ? {
          schedule: {
            cron: backup.schedule.cron,
            timezone: "UTC" as const,
          },
        }
      : {}),
  };
}

export function validateBackupCron(expression: string) {
  const job = new Cron(expression, {
    mode: "5-part",
    paused: true,
    timezone: "UTC",
  });
  const runs = job.nextRuns(128, new Date("2024-01-01T00:00:00.000Z"));
  if (runs.length < 2) return;
  for (let index = 1; index < runs.length; index += 1) {
    if (runs[index]!.getTime() - runs[index - 1]!.getTime() < 60 * 60_000) {
      throw new Error(
        "Backup cron schedules cannot run more than once per hour",
      );
    }
  }
}

export function getLatestBackupScheduleOccurrence(
  expression: string,
  now = new Date(),
) {
  validateBackupCron(expression);
  return (
    new Cron(expression, {
      mode: "5-part",
      paused: true,
      timezone: "UTC",
    }).previousRuns(1, new Date(now.getTime() + 1_000))[0] ?? null
  );
}

function normalizeResourceHealth(
  resource: z.output<typeof resourceSchema>,
  port: number | undefined,
): NormalizedResource["health"] {
  if (resource.health?.type === "command") {
    return {
      command: [...resource.health.command!],
      timeoutSeconds: resource.health.timeoutSeconds ?? 60,
      type: "command",
    };
  }
  if (resource.health?.type === "http") {
    return {
      path: resource.health.path!,
      timeoutSeconds: resource.health.timeoutSeconds ?? 60,
      type: "http",
    };
  }
  if (resource.health?.type === "container") {
    return {
      timeoutSeconds: resource.health.timeoutSeconds ?? 60,
      type: "container",
    };
  }
  if (resource.type === "postgres") {
    return {
      command: [
        "sh",
        "-c",
        'pg_isready -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-postgres}"',
      ],
      timeoutSeconds: 60,
      type: "command",
    };
  }
  if (resource.type === "mysql") {
    return {
      command: [
        "sh",
        "-c",
        'mysqladmin ping -h 127.0.0.1 -u root -p"$MYSQL_ROOT_PASSWORD" --silent',
      ],
      timeoutSeconds: 60,
      type: "command",
    };
  }
  if (resource.type === "mariadb") {
    return {
      command: [
        "sh",
        "-c",
        'mariadb-admin ping -h 127.0.0.1 -u root -p"$MYSQL_ROOT_PASSWORD" --silent',
      ],
      timeoutSeconds: 60,
      type: "command",
    };
  }
  if (resource.type === "mongodb") {
    return {
      command: [
        "sh",
        "-c",
        'mongosh --quiet --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --eval "quit(db.adminCommand({ping:1}).ok ? 0 : 1)"',
      ],
      timeoutSeconds: 60,
      type: "command",
    };
  }
  if (resource.type === "redis") {
    return {
      command: [
        "sh",
        "-c",
        'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning ping',
      ],
      timeoutSeconds: 60,
      type: "command",
    };
  }
  if (resource.type === "dragonfly" || resource.type === "keydb") {
    return {
      command: [
        "sh",
        "-c",
        'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning ping',
      ],
      timeoutSeconds: 60,
      type: "command",
    };
  }
  if (resource.type === "clickhouse") {
    return {
      command: [
        "sh",
        "-c",
        'clickhouse-client --user "$CLICKHOUSE_USER" --password "$CLICKHOUSE_PASSWORD" --query "SELECT 1"',
      ],
      timeoutSeconds: 60,
      type: "command",
    };
  }
  return port
    ? { path: "/", timeoutSeconds: 60, type: "http" }
    : { timeoutSeconds: 60, type: "container" };
}

function defaultResourceImage(type: ResourceType) {
  return type === "image"
    ? undefined
    : managedResourceCompatibility[type].image;
}

function defaultResourcePort(type: ResourceType) {
  return {
    postgres: 5_432,
    mysql: 3_306,
    mariadb: 3_306,
    mongodb: 27_017,
    redis: 6_379,
    dragonfly: 6_379,
    keydb: 6_379,
    clickhouse: 8_123,
    image: undefined,
  }[type];
}

function defaultResourceVolume(type: ResourceType, image: string) {
  if (type === "postgres") {
    return {
      mountPath:
        postgresImageMajorVersion(image) >= 18
          ? "/var/lib/postgresql"
          : "/var/lib/postgresql/data",
      name: "data",
    };
  }
  const mountPath = {
    mysql: "/var/lib/mysql",
    mariadb: "/var/lib/mysql",
    mongodb: "/data/db",
    redis: "/data",
    dragonfly: "/data",
    keydb: "/data",
    clickhouse: "/var/lib/clickhouse",
    image: undefined,
  }[type];
  return mountPath ? { mountPath, name: "data" } : undefined;
}

function postgresImageMajorVersion(image: string) {
  const tag = image.split("@")[0]?.split(":").at(-1) ?? "";
  const match = /^(\d+)/u.exec(tag);
  return match ? Number(match[1]) : 0;
}

function defaultResourceLimits(type: ResourceType) {
  return type === "postgres" || type === "clickhouse"
    ? { cpus: 1, memory: "1g" }
    : { cpus: 0.5, memory: "512m" };
}

function hasImmutableImageSelector(image: string) {
  if (image.includes("@")) return true;
  const finalSegment = image.split("/").at(-1) ?? "";
  const tag = finalSegment.includes(":")
    ? finalSegment.slice(finalSegment.lastIndexOf(":") + 1)
    : "";
  return Boolean(tag) && tag.toLowerCase() !== "latest";
}

function normalizeDeploymentHook(input: {
  command: string[];
  timeoutSeconds?: number;
}): NormalizedDeploymentHook {
  return {
    command: [...input.command],
    timeoutSeconds: input.timeoutSeconds ?? 300,
  };
}

function normalizePreviewConfig(
  input: z.output<typeof appSchema>["preview"],
): Pick<NormalizedApp, "preview"> {
  if (!input) return {};
  return {
    preview: {
      domain: normalizeDomain(input.domain),
      enabled: true,
      ttlHours: input.ttlHours ?? 72,
    },
  };
}
