import { requiresServerPreparation } from "@workspace/towbar-core";

import type {
  DeploymentPlanCheck,
  NormalizedDeploymentManifest,
  NormalizedServer,
  RuntimeCapacity,
} from "@workspace/towbar-core";

export type DeploymentPlanValidationContext = {
  activeOperationDescriptions: string[];
  capacities: RuntimeCapacity[];
  credentialStatus: "failed" | "unverified" | "verified" | null;
  existingDomainClaims: Array<{ domain: string; manifestId: string }>;
  materializedServers: Array<{
    config: NormalizedServer;
    configDigest: string;
    ip: string;
    preparedAt: Date | null;
    preparedConfigDigest: string | null;
  }>;
  secretBindings: Array<{ available: boolean; reference: string }>;
  sourceBranch: string;
};

export function buildDeploymentPlanValidationChecks(input: {
  context: DeploymentPlanValidationContext;
  manifest: NormalizedDeploymentManifest;
}): DeploymentPlanCheck[] {
  return [
    {
      code: "manifest_schema",
      message: "The candidate manifest matches the Towbar v1 schema",
      status: "passed",
    },
    ...validateSourceBranch(input),
    ...validateDomains(input),
    ...validateServers(input),
    ...validateSecretBindings(input),
    ...validateOperationConflicts(input.context.activeOperationDescriptions),
  ];
}

export function collectSecretReferences(value: unknown) {
  const references = new Set<string>();
  visitStrings(value, (candidate) => {
    if (candidate.startsWith("aws:")) references.add(candidate);
  });
  return [...references].sort((left, right) => left.localeCompare(right));
}

export function parseDockerMemoryBytes(value: string) {
  const match = /^(\d+(?:\.\d+)?)([bkmg])$/iu.exec(value.trim());
  if (!match) return null;
  const amount = Number(match[1]);
  const exponent = { b: 0, g: 3, k: 1, m: 2 }[
    match[2]!.toLowerCase() as "b" | "g" | "k" | "m"
  ];
  return amount * 1_024 ** exponent;
}

function validateSourceBranch(input: {
  context: DeploymentPlanValidationContext;
  manifest: NormalizedDeploymentManifest;
}): DeploymentPlanCheck[] {
  if (input.manifest.source.branch === input.context.sourceBranch) return [];
  return [
    {
      code: "source_branch_mismatch",
      entityKind: "source",
      message: `Candidate source.branch '${input.manifest.source.branch}' does not match configured branch '${input.context.sourceBranch}'`,
      status: "failed",
    },
  ];
}

function validateDomains(input: {
  context: DeploymentPlanValidationContext;
  manifest: NormalizedDeploymentManifest;
}) {
  const claims = new Map(
    input.context.existingDomainClaims.map((claim) => [claim.domain, claim]),
  );
  return deployables(input.manifest).flatMap<DeploymentPlanCheck>(
    (deployable) =>
      deployable.domains
        ? [
            deployable.domains.primary,
            ...deployable.domains.redirects.map((redirect) => redirect.host),
          ].flatMap((domain) => {
            const claim = claims.get(domain);
            return claim
              ? [
                  {
                    code: "domain_conflict",
                    entityId: deployable.id,
                    entityKind:
                      deployable.kind && deployable.kind !== "app"
                        ? ("resource" as const)
                        : ("app" as const),
                    message: `Domain '${domain}' is already claimed by '${claim.manifestId}'`,
                    references: [domain],
                    status: "failed" as const,
                  },
                ]
              : [];
          })
        : [],
  );
}

function validateServers(input: {
  context: DeploymentPlanValidationContext;
  manifest: NormalizedDeploymentManifest;
}) {
  const materialized = new Map(
    input.context.materializedServers.map((server) => [server.ip, server]),
  );
  const capacities = new Map(
    input.context.capacities.map((capacity) => [capacity.ip, capacity]),
  );
  return input.manifest.servers.flatMap<DeploymentPlanCheck>((server) => {
    const checks: DeploymentPlanCheck[] = [];
    const current = materialized.get(server.ip);
    if (!current) {
      checks.push({
        code: "server_not_materialized",
        entityId: server.ip,
        entityKind: "server",
        message:
          "Sync this Source, trust its SSH host key, and prepare the new server before deployment",
        status: "failed",
      });
      return checks;
    }
    if (
      !current.preparedAt ||
      current.preparedConfigDigest !== current.configDigest ||
      requiresServerPreparation(current.config, server)
    ) {
      checks.push({
        code: "server_not_ready",
        entityId: server.ip,
        entityKind: "server",
        message:
          "The server must be prepared for the candidate configuration before deployment",
        status: "failed",
      });
    } else {
      checks.push({
        code: "server_ready",
        entityId: server.ip,
        entityKind: "server",
        message: "The server is prepared for the candidate configuration",
        status: "passed",
      });
    }
    checks.push(
      ...capacityChecks(input.manifest, server.ip, capacities.get(server.ip)),
    );
    return checks;
  });
}

function capacityChecks(
  manifest: NormalizedDeploymentManifest,
  serverIp: string,
  capacity: RuntimeCapacity | undefined,
): DeploymentPlanCheck[] {
  if (!capacity) {
    return [
      {
        code: "capacity_unavailable",
        entityId: serverIp,
        entityKind: "server",
        message:
          "Run a server check to validate host capacity before deployment",
        status: "warning",
      },
    ];
  }
  const checks: DeploymentPlanCheck[] = [];
  if (capacity.status === "critical" || capacity.status === "attention") {
    checks.push({
      code: "capacity_health",
      entityId: serverIp,
      entityKind: "server",
      message:
        capacity.status === "critical"
          ? "The latest server check reports critical capacity or health pressure"
          : "The latest server check recommends reviewing host capacity",
      status: capacity.status === "critical" ? "failed" : "warning",
    });
  } else if (capacity.status === "unknown") {
    checks.push({
      code: "capacity_unknown",
      entityId: serverIp,
      entityKind: "server",
      message: "Run a fresh server check to validate host capacity",
      status: "warning",
    });
  }

  const declared = deployables(manifest)
    .filter((deployable) => deployable.server === serverIp)
    .reduce(
      (total, deployable) => {
        const resources = deployable.container.resources;
        if (!resources) return total;
        return {
          cpus: total.cpus + resources.cpus,
          memoryBytes:
            total.memoryBytes + (parseDockerMemoryBytes(resources.memory) ?? 0),
        };
      },
      { cpus: 0, memoryBytes: 0 },
    );
  if (capacity.cpu && declared.cpus > capacity.cpu.logicalCount) {
    checks.push({
      code: "cpu_capacity_exceeded",
      entityId: serverIp,
      entityKind: "server",
      message: `Declared container CPU limits (${declared.cpus}) exceed ${capacity.cpu.logicalCount} logical CPUs`,
      status: "failed",
    });
  }
  if (capacity.memory && declared.memoryBytes > capacity.memory.totalBytes) {
    checks.push({
      code: "memory_capacity_exceeded",
      entityId: serverIp,
      entityKind: "server",
      message: "Declared container memory limits exceed total host memory",
      status: "failed",
    });
  }
  if (checks.length === 0) {
    checks.push({
      code: "capacity_available",
      entityId: serverIp,
      entityKind: "server",
      message: "The latest server check has sufficient declared capacity",
      status: "passed",
    });
  }
  return checks;
}

function validateSecretBindings(input: {
  context: DeploymentPlanValidationContext;
  manifest: NormalizedDeploymentManifest;
}): DeploymentPlanCheck[] {
  const references = collectSecretReferences(input.manifest);
  if (references.length === 0) return [];
  if (input.context.credentialStatus !== "verified") {
    return [
      {
        code: "secret_bindings_unavailable",
        entityKind: "source",
        message:
          "Configure and verify Source AWS credentials before using the declared secret bindings",
        references,
        status: "failed",
      },
    ];
  }
  const unavailable = input.context.secretBindings.filter(
    (binding) => !binding.available,
  );
  if (unavailable.length > 0) {
    return unavailable.map((binding) => ({
      code: "secret_binding_unavailable",
      entityKind: "source" as const,
      message: `Secret binding '${binding.reference}' was not found or cannot be described by the Source AWS credentials`,
      references: [binding.reference],
      status: "failed" as const,
    }));
  }
  return [
    {
      code: "secret_bindings_declared",
      entityKind: "source",
      message: `${references.length} secret binding${references.length === 1 ? " is" : "s are"} declared by name; values were not resolved`,
      references,
      status: "passed",
    },
  ];
}

function validateOperationConflicts(descriptions: string[]) {
  return [...descriptions]
    .sort((left, right) => left.localeCompare(right))
    .map<DeploymentPlanCheck>((description) => ({
      code: "operation_conflict",
      entityKind: "source",
      message: description,
      status: "failed",
    }));
}

function deployables(manifest: NormalizedDeploymentManifest) {
  return [...manifest.apps, ...(manifest.resources ?? [])];
}

function visitStrings(value: unknown, callback: (value: string) => void) {
  if (typeof value === "string") {
    callback(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) visitStrings(item, callback);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const item of Object.values(value)) visitStrings(item, callback);
}
