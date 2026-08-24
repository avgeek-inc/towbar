/* eslint-disable max-lines -- The versioned manifest schema, normalized DTO, and parser stay together so their public contract cannot drift across modules. */

import { isIP } from "node:net";
import path from "node:path";

import { Cron } from "croner";
import { parseDocument } from "yaml";
import { z } from "zod";

import { secretReferenceSchema } from "./secret-reference.js";
import {
  canonicalIp,
  digestValue,
  findDependencyCycles,
  findDuplicates,
  isValidBranchName,
  normalizeDomain,
  normalizeRepositoryPath,
} from "./manifest-values.js";

export {
  digestValue,
  normalizeDomain,
  normalizeRepositoryPath,
  stableStringify,
  validateSecretObject,
  validateServerLoginSecret,
} from "./manifest-values.js";

const MAX_MANIFEST_BYTES = 256 * 1_024;
const appIdPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const deploymentInputGroupPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const dockerNetworkPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const dockerMemoryPattern = /^\d+(?:\.\d+)?[bkmg]$/i;
const dockerVolumePattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const dockerImagePattern = /^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,511}$/;
const s3BucketPattern =
  /^(?!\d+\.\d+\.\d+\.\d+$)[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
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

const ipAddressSchema = z
  .string()
  .trim()
  .refine((value) => isIP(value) !== 0, "Expected an IPv4 or IPv6 address");

const redirectSchema = z
  .object({
    host: domainSchema,
    status: z.union([z.literal(301), z.literal(302)]).optional(),
  })
  .strict();

const serverSchema = z
  .object({
    buildConcurrency: z.number().int().min(1).max(16).optional(),
    ip: ipAddressSchema,
    ssh: z
      .object({
        host: ipAddressSchema.optional(),
        username: z.string().trim().regex(sshUsernamePattern),
        port: z.number().int().min(1).max(65_535).optional(),
      })
      .strict(),
    secrets: z
      .object({
        login: secretReferenceSchema,
      })
      .strict(),
    proxy: z
      .object({
        cloudflare: z
          .object({
            apiToken: secretReferenceSchema,
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
    secrets: secretReferenceSchema.optional(),
    timeoutSeconds: z.number().int().min(5).max(1_800).optional(),
  })
  .strict();

const sharedSecretsSchema = z
  .object({
    build: z.array(secretReferenceSchema).max(50).optional(),
    deployment: z.array(secretReferenceSchema).max(50).optional(),
  })
  .strict()
  .superRefine((secrets, context) => {
    for (const category of ["build", "deployment"] as const) {
      findDuplicates(secrets[category] ?? []).forEach((reference) =>
        context.addIssue({
          code: "custom",
          message: `Shared ${category} secret '${reference}' is declared more than once`,
          path: [category],
        }),
      );
    }
  });

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

const resourceBackupSchema = z
  .object({
    retention: z
      .object({ keepLast: z.number().int().min(1).max(100).optional() })
      .strict()
      .optional(),
    s3: z
      .object({
        bucket: z.string().trim().regex(s3BucketPattern),
        encryption: z.enum(["AES256", "aws:kms"]).optional(),
        kmsKeyId: z.string().trim().min(1).max(2_048).optional(),
        prefix: z
          .string()
          .trim()
          .max(512)
          .refine(
            (value) =>
              !value.startsWith("/") &&
              !value.split("/").some((segment) => segment === ".."),
            "S3 backup prefix must be relative and cannot contain parent traversal",
          )
          .optional(),
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
      }),
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
  .strict();

const appSchema = z
  .object({
    autoDeploy: appAutoDeploySchema.optional(),
    id: z.string().trim().regex(appIdPattern),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).optional(),
    server: ipAddressSchema,
    dockerfile: repositoryPathSchema,
    context: repositoryPathSchema.optional(),
    dependsOn: z
      .array(z.string().trim().regex(appIdPattern))
      .max(50)
      .optional(),
    container: z
      .object({
        network: z.string().trim().regex(dockerNetworkPattern).optional(),
        port: z.number().int().min(1).max(65_535),
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
    secrets: z
      .object({
        build: secretReferenceSchema.optional(),
        deployment: secretReferenceSchema.optional(),
      })
      .strict()
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
  })
  .strict()
  .superRefine((app, context) => {
    let normalizedContext: string;
    let normalizedDockerfile: string;
    try {
      normalizedContext = normalizeRepositoryPath(app.context ?? ".");
      normalizedDockerfile = normalizeRepositoryPath(app.dockerfile);
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
        path: ["dockerfile"],
      });
    }

    if (app.tls && !app.domains) {
      context.addIssue({
        code: "custom",
        message: "TLS configuration requires a primary domain",
        path: ["tls"],
      });
    }
  });

function validateResourceBackupSupport(
  resource: { backup?: unknown; type: "image" | "postgres" | "redis" },
  context: z.RefinementCtx,
) {
  if (resource.type !== "image" || !resource.backup) return;
  context.addIssue({
    code: "custom",
    message:
      "Managed backups are available only for PostgreSQL and Redis resources",
    path: ["backup"],
  });
}

function validateResourceImageAndCommand(
  resource: {
    container?: { command?: string[] };
    image?: string;
    type: "image" | "postgres" | "redis";
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

function validateResourceConnectivity(
  resource: {
    access?: { sshTunnel: { hostPort: number } };
    container?: { network?: string; networkAlias?: string; port?: number };
    type: "image" | "postgres" | "redis";
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

const resourceSchema = z
  .object({
    access: resourceAccessSchema.optional(),
    autoDeploy: z.boolean().optional(),
    backup: resourceBackupSchema.optional(),
    id: z.string().trim().regex(appIdPattern),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).optional(),
    type: z.enum(["image", "postgres", "redis"]),
    image: z.string().trim().regex(dockerImagePattern).optional(),
    server: ipAddressSchema,
    dependsOn: z
      .array(z.string().trim().regex(appIdPattern))
      .max(50)
      .optional(),
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
    secrets: z
      .object({ deployment: secretReferenceSchema.optional() })
      .strict()
      .optional(),
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
    validateResourceConnectivity(resource, context);
    validateResourceBackupSupport(resource, context);
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
  });

export const deploymentManifestSchema = z
  .object({
    version: z.literal(1),
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
    secrets: sharedSecretsSchema.optional(),
    servers: z.array(serverSchema).min(1).max(100),
    apps: z.array(appSchema).max(500).optional(),
    resources: z.array(resourceSchema).max(500).optional(),
  })
  .strict()
  .superRefine((manifest, context) => {
    if ((manifest.apps?.length ?? 0) + (manifest.resources?.length ?? 0) < 1) {
      context.addIssue({
        code: "custom",
        message: "Declare at least one app or resource",
        path: [],
      });
    }
    findDuplicates(
      manifest.servers.map((server) => canonicalIp(server.ip)),
    ).forEach((ip) =>
      context.addIssue({
        code: "custom",
        message: `Server IP '${ip}' is declared more than once`,
        path: ["servers"],
      }),
    );

    const deployables = [
      ...(manifest.apps ?? []),
      ...(manifest.resources ?? []),
    ];
    findDuplicates(deployables.map((deployable) => deployable.id)).forEach(
      (id) =>
        context.addIssue({
          code: "custom",
          message: `Deployable id '${id}' is declared more than once`,
          path: [],
        }),
    );

    const serverByIp = new Map(
      manifest.servers.map((server) => [canonicalIp(server.ip), server]),
    );
    const deployableIds = new Set(
      deployables.map((deployable) => deployable.id),
    );
    const claimedDomains = new Map<string, string>();
    const claimedNetworkAliases = new Map<string, string>();
    const claimedSshTunnelPorts = new Map<string, string>();

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
            message: `Network alias '${alias}' is already claimed by resource '${owner}' on this server and network`,
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
      const serverIp = canonicalIp(app.server);
      const server = serverByIp.get(serverIp);
      if (!server) {
        context.addIssue({
          code: "custom",
          message: `App references undeclared server '${serverIp}'`,
          path: [collection, appIndex, "server"],
        });
      }

      if (app.tls?.mode === "cloudflare-dns" && !server?.proxy?.cloudflare) {
        context.addIssue({
          code: "custom",
          message:
            "Cloudflare DNS TLS requires proxy.cloudflare.apiToken on the target server",
          path: [collection, appIndex, "tls", "mode"],
        });
      }

      findDuplicates(app.dependsOn ?? []).forEach((dependencyId) =>
        context.addIssue({
          code: "custom",
          message: `Dependency '${dependencyId}' is declared more than once`,
          path: [collection, appIndex, "dependsOn"],
        }),
      );
      (app.dependsOn ?? []).forEach((dependencyId, dependencyIndex) => {
        if (dependencyId === app.id) {
          context.addIssue({
            code: "custom",
            message: "An app cannot depend on itself",
            path: [collection, appIndex, "dependsOn", dependencyIndex],
          });
        } else if (!deployableIds.has(dependencyId)) {
          context.addIssue({
            code: "custom",
            message: `Dependency '${dependencyId}' is not declared in this manifest`,
            path: [collection, appIndex, "dependsOn", dependencyIndex],
          });
        }
      });

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

    for (const appId of findDependencyCycles(deployables)) {
      const appIndex = deployables.findIndex((app) => app.id === appId);
      context.addIssue({
        code: "custom",
        message: `Deployable '${appId}' participates in a dependency cycle`,
        path: ["dependsOn", appIndex],
      });
    }
  });

export type DeploymentManifestInput = z.input<typeof deploymentManifestSchema>;

export type NormalizedServer = {
  buildConcurrency: number;
  ip: string;
  proxy?: {
    cloudflare: {
      apiToken: string;
    };
  };
  secrets: {
    login: string;
  };
  ssh: { host: string; port: number; username: string };
};

export type NormalizedDeploymentHook = {
  command: string[];
  secrets?: string;
  timeoutSeconds: number;
};

export type NormalizedApp = {
  kind?: "app";
  autoDeploy: boolean;
  container: {
    network?: string;
    port: number;
    resources?: { cpus: number; memory: string };
  };
  context: string;
  deploymentInputs: string[];
  dependsOn: string[];
  description?: string;
  dockerfile: string;
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
  secrets: {
    build?: string;
    deployment?: string;
  };
  sharedSecrets?: {
    build: string[];
    deployment: string[];
  };
  server: string;
  sourceBranch: string;
  tls?: { mode: "direct" | "cloudflare-dns" };
};

export type NormalizedResource = {
  access?: {
    sshTunnel: { hostPort: number };
  };
  autoDeploy: boolean;
  backup?: {
    retention: { keepLast: number };
    s3: {
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
  dependsOn: string[];
  description?: string;
  domains?: NormalizedApp["domains"];
  health:
    | { command: string[]; timeoutSeconds: number; type: "command" }
    | { timeoutSeconds: number; type: "container" }
    | { path: string; timeoutSeconds: number; type: "http" };
  id: string;
  image: string;
  kind: "image" | "postgres" | "redis";
  name: string;
  secrets: { deployment?: string };
  server: string;
  sharedSecrets: {
    build: string[];
    deployment: string[];
  };
  sourceBranch: string;
  tls?: { mode: "direct" | "cloudflare-dns" };
};

export type NormalizedDeployable = NormalizedApp | NormalizedResource;

export type NormalizedDeploymentManifest = {
  apps: NormalizedApp[];
  resources?: NormalizedResource[];
  secrets?: { build: string[]; deployment: string[] };
  servers: NormalizedServer[];
  source: { branch: string };
  version: 1;
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

export function parseDeploymentManifest(source: string) {
  if (Buffer.byteLength(source, "utf8") > MAX_MANIFEST_BYTES) {
    throw new ManifestValidationError([
      {
        message: `Manifest exceeds the ${MAX_MANIFEST_BYTES}-byte limit`,
        path: [],
      },
    ]);
  }

  const document = parseDocument(source, {
    prettyErrors: false,
    strict: true,
    uniqueKeys: true,
  });
  if (document.errors.length > 0) {
    throw new ManifestValidationError(
      document.errors.map((error) => ({
        ...(error.linePos?.[0]
          ? {
              column: error.linePos[0].col,
              line: error.linePos[0].line,
            }
          : {}),
        message: error.message,
        path: [],
      })),
    );
  }

  let value: unknown;
  try {
    value = document.toJS({ maxAliasCount: 0 });
  } catch (error) {
    throw new ManifestValidationError([
      {
        message:
          error instanceof Error ? error.message : "Unable to decode YAML",
        path: [],
      },
    ]);
  }

  const result = deploymentManifestSchema.safeParse(value);
  if (!result.success) {
    throw new ManifestValidationError(
      result.error.issues.map((issue) => ({
        message: issue.message,
        path: issue.path.map((part) =>
          typeof part === "symbol" ? (part.description ?? "symbol") : part,
        ),
      })),
    );
  }

  const manifest = normalizeDeploymentManifest(result.data);
  return {
    digest: digestValue(manifest),
    manifest,
  };
}

export function normalizeDeploymentManifest(
  manifest: DeploymentManifestInput,
): NormalizedDeploymentManifest {
  const parsed = deploymentManifestSchema.parse(manifest);
  const sourceBranch = parsed.source?.branch ?? "main";
  const sharedSecrets = {
    build: [...(parsed.secrets?.build ?? [])],
    deployment: [...(parsed.secrets?.deployment ?? [])],
  };
  return {
    version: 1,
    source: { branch: sourceBranch },
    secrets: sharedSecrets,
    servers: parsed.servers
      .map((server) => ({
        buildConcurrency: server.buildConcurrency ?? 1,
        ip: canonicalIp(server.ip),
        ssh: {
          host: canonicalIp(server.ssh.host ?? server.ip),
          port: server.ssh.port ?? 22,
          username: server.ssh.username,
        },
        secrets: { login: server.secrets.login },
        ...(server.proxy?.cloudflare
          ? {
              proxy: {
                cloudflare: {
                  apiToken: server.proxy.cloudflare.apiToken,
                },
              },
            }
          : {}),
      }))
      .sort((left, right) => left.ip.localeCompare(right.ip)),
    apps: (parsed.apps ?? [])
      .map((app) => {
        const automaticDeployment = normalizeAutomaticDeployment(
          app.autoDeploy,
          parsed.deploymentInputs,
        );
        return {
          kind: "app" as const,
          autoDeploy: automaticDeployment.enabled,
          id: app.id,
          name: app.name,
          ...(app.description ? { description: app.description } : {}),
          server: canonicalIp(app.server),
          sourceBranch,
          dockerfile: normalizeRepositoryPath(app.dockerfile),
          context: normalizeRepositoryPath(app.context ?? "."),
          deploymentInputs: automaticDeployment.inputs,
          dependsOn: [...(app.dependsOn ?? [])].sort(),
          container: {
            ...(app.container.network
              ? { network: app.container.network.trim() }
              : {}),
            port: app.container.port,
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
          secrets: {
            ...(app.secrets?.build ? { build: app.secrets.build } : {}),
            ...(app.secrets?.deployment
              ? { deployment: app.secrets.deployment }
              : {}),
          },
          sharedSecrets,
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
    resources: (parsed.resources ?? [])
      .map((resource) =>
        normalizeResource(resource, sourceBranch, sharedSecrets),
      )
      .sort((left, right) => left.id.localeCompare(right.id)),
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
    deployable.kind === "image" ||
    deployable.kind === "postgres" ||
    deployable.kind === "redis"
  );
}

function normalizeResource(
  resource: z.output<typeof resourceSchema>,
  sourceBranch: string,
  sharedSecrets: { build: string[]; deployment: string[] },
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
    autoDeploy: resource.autoDeploy ?? false,
    ...(backup ? { backup } : {}),
    container: normalizeResourceContainer(resource, kind, port, volumes),
    dependsOn: [...(resource.dependsOn ?? [])].sort(),
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
    secrets: resource.secrets?.deployment
      ? { deployment: resource.secrets.deployment }
      : {},
    server: canonicalIp(resource.server),
    sharedSecrets,
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
  return {
    retention: { keepLast: backup.retention?.keepLast ?? 7 },
    s3: {
      bucket: backup.s3.bucket,
      encryption: backup.s3.encryption ?? "AES256",
      ...(backup.s3.kmsKeyId ? { kmsKeyId: backup.s3.kmsKeyId } : {}),
      prefix: backup.s3.prefix || "towbar",
      ...(backup.s3.region ? { region: backup.s3.region } : {}),
    },
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
  return port
    ? { path: "/", timeoutSeconds: 60, type: "http" }
    : { timeoutSeconds: 60, type: "container" };
}

function defaultResourceImage(type: "image" | "postgres" | "redis") {
  if (type === "postgres") return "postgres:17-alpine";
  if (type === "redis") return "redis:8-alpine";
  return undefined;
}

function defaultResourcePort(type: "image" | "postgres" | "redis") {
  if (type === "postgres") return 5_432;
  if (type === "redis") return 6_379;
  return undefined;
}

function defaultResourceVolume(
  type: "image" | "postgres" | "redis",
  image: string,
) {
  if (type === "postgres") {
    return {
      mountPath:
        postgresImageMajorVersion(image) >= 18
          ? "/var/lib/postgresql"
          : "/var/lib/postgresql/data",
      name: "data",
    };
  }
  if (type === "redis") return { mountPath: "/data", name: "data" };
  return undefined;
}

function postgresImageMajorVersion(image: string) {
  const tag = image.split("@")[0]?.split(":").at(-1) ?? "";
  const match = /^(\d+)/u.exec(tag);
  return match ? Number(match[1]) : 0;
}

function defaultResourceLimits(type: "image" | "postgres" | "redis") {
  return type === "postgres"
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
  secrets?: string;
  timeoutSeconds?: number;
}): NormalizedDeploymentHook {
  return {
    command: [...input.command],
    ...(input.secrets ? { secrets: input.secrets } : {}),
    timeoutSeconds: input.timeoutSeconds ?? 300,
  };
}
