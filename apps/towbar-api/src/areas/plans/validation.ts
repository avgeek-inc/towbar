import { requiresServerPreparation } from "@workspace/towbar-core";

import type {
  DeploymentPlanCheck,
  DeploymentPlanItem,
  NormalizedDeploymentManifest,
  NormalizedServer,
  RuntimeCapacity,
} from "@workspace/towbar-core";

export type DeploymentPlanValidationScope = {
  deployableIds: string[];
  serverIps: string[];
};

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
  scope?: DeploymentPlanValidationScope;
}): DeploymentPlanCheck[] {
  const scope = input.scope ?? fullManifestScope(input.manifest);
  return [
    ...buildCandidateDeploymentPlanValidationChecks({
      manifest: input.manifest,
      sourceBranch: input.context.sourceBranch,
    }),
    ...validateDomains({ ...input, scope }),
    ...validateServers({ ...input, scope }),
    ...validateSecretBindings({ ...input, scope }),
    ...validateOperationConflicts(input.context.activeOperationDescriptions),
  ];
}

export function buildCandidateDeploymentPlanValidationChecks(input: {
  manifest: NormalizedDeploymentManifest;
  sourceBranch: string;
}): DeploymentPlanCheck[] {
  return [
    {
      code: "manifest_schema",
      message: "The candidate manifest matches the Towbar v1 schema",
      status: "passed",
    },
    ...validateSourceBranch({
      context: { sourceBranch: input.sourceBranch },
      manifest: input.manifest,
    }),
  ];
}

export function buildDeploymentPlanValidationScope(input: {
  items: DeploymentPlanItem[];
  manifest: NormalizedDeploymentManifest;
}): DeploymentPlanValidationScope {
  const deployableIds = new Set(
    input.items
      .filter(
        (item) =>
          item.action !== "no_op" &&
          (item.entityKind === "app" || item.entityKind === "resource"),
      )
      .map((item) => item.entityId),
  );
  const serverIps = new Set(
    input.items
      .filter((item) => item.action !== "no_op" && item.entityKind === "server")
      .map((item) => item.entityId),
  );
  for (const deployable of deployables(input.manifest)) {
    if (deployableIds.has(deployable.id)) serverIps.add(deployable.server);
  }
  return {
    deployableIds: [...deployableIds].sort((left, right) =>
      left.localeCompare(right),
    ),
    serverIps: [...serverIps].sort((left, right) => left.localeCompare(right)),
  };
}

export function collectPlanSecretReferences(
  manifest: NormalizedDeploymentManifest,
  scope: DeploymentPlanValidationScope,
) {
  const deployableIds = new Set(scope.deployableIds);
  const serverIps = new Set(scope.serverIps);
  const scopedDeployables = deployables(manifest).filter((deployable) =>
    deployableIds.has(deployable.id),
  );
  return collectSecretReferences([
    ...(scopedDeployables.length > 0 ? [manifest.secrets] : []),
    ...scopedDeployables,
    ...manifest.servers.filter((server) => serverIps.has(server.ip)),
  ]);
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
  context: Pick<DeploymentPlanValidationContext, "sourceBranch">;
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
  scope: DeploymentPlanValidationScope;
}) {
  const claims = new Map(
    input.context.existingDomainClaims.map((claim) => [claim.domain, claim]),
  );
  const deployableIds = new Set(input.scope.deployableIds);
  return deployables(input.manifest)
    .filter((deployable) => deployableIds.has(deployable.id))
    .flatMap<DeploymentPlanCheck>((deployable) =>
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
  scope: DeploymentPlanValidationScope;
}) {
  const materialized = new Map(
    input.context.materializedServers.map((server) => [server.ip, server]),
  );
  const capacities = new Map(
    input.context.capacities.map((capacity) => [capacity.ip, capacity]),
  );
  const serverIps = new Set(input.scope.serverIps);
  return input.manifest.servers
    .filter((server) => serverIps.has(server.ip))
    .flatMap<DeploymentPlanCheck>((server) => {
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
      status: "warning",
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
  scope: DeploymentPlanValidationScope;
}): DeploymentPlanCheck[] {
  const references = collectPlanSecretReferences(input.manifest, input.scope);
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
      status: "warning",
    }));
}

function deployables(manifest: NormalizedDeploymentManifest) {
  return [...manifest.apps, ...(manifest.resources ?? [])];
}

function fullManifestScope(
  manifest: NormalizedDeploymentManifest,
): DeploymentPlanValidationScope {
  return {
    deployableIds: deployables(manifest).map((deployable) => deployable.id),
    serverIps: manifest.servers.map((server) => server.ip),
  };
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
