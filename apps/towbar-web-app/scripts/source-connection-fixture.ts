import { randomUUID } from "node:crypto";
import { sourceEnvironmentMappingSchema } from "@workspace/towbar-core";
import type {
  App,
  Resource,
  Source,
  SourceSync,
} from "@workspace/towbar-web-client";

type ConnectedApp = App & { serverId: string };
type ConnectedResource = Resource & {
  serverId: string;
  serverSsh: { port: number; username: string };
};

function initialRuntimeState(): App["runtimeState"] {
  return {
    checkedAt: null,
    desiredState: "running",
    driftReasons: [],
    driftStatus: "unknown",
    healthStatus: "unknown",
    observedContainerName: null,
    observedImage: null,
    observedState: "unknown",
  };
}

export class FixtureEnvironmentError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type Mapping = {
  id: string;
  sourceId: string;
  name: string;
  branch: string;
  mappingRevision: string;
  previewsEnabled: boolean;
  latestSyncStatus: "succeeded";
  latestSyncFinishedAt: string;
  latestSuccessfulSyncId: string;
  disconnectedAt: string | null;
};

function makeMapping(sourceId: string, name: string, branch: string): Mapping {
  return {
    id: randomUUID(),
    sourceId,
    name,
    branch,
    mappingRevision: randomUUID(),
    previewsEnabled: name === "staging",
    latestSyncStatus: "succeeded",
    latestSyncFinishedAt: new Date().toISOString(),
    latestSuccessfulSyncId: randomUUID(),
    disconnectedAt: null,
  };
}

export function createSourceConnectionFixture(input: {
  existing: Source[];
  installationId: string;
  app: ConnectedApp;
  resource: ConnectedResource;
}) {
  const sources: Source[] = [],
    apps: ConnectedApp[] = [],
    resources: ConnectedResource[] = [],
    mappings: Mapping[] = [];
  const history: (SourceSync & {
    sourceId: string;
    branch: string;
    deployAfterSync: boolean;
  })[] = [];
  const materialize = (source: Source, environment: Mapping) => {
    const now = new Date().toISOString();
    const appEntityId =
      apps.find((item) => item.sourceId === source.id)?.entityId ??
      randomUUID();
    const resourceEntityId =
      resources.find((item) => item.sourceId === source.id)?.entityId ??
      randomUUID();
    apps.push({
      ...structuredClone(input.app),
      id: randomUUID(),
      entityId: appEntityId,
      sourceId: source.id,
      name: "Example Service",
      manifestId: "service",
      environment,
      config: {
        ...structuredClone(input.app.config),
        id: "service",
        name: "Example Service",
        sourceBranch: environment.branch,
        autoDeploy: false,
      },
      runtimeState: initialRuntimeState(),
      archivedAt: null,
      updatedAt: now,
    });
    resources.push({
      ...structuredClone(input.resource),
      id: randomUUID(),
      entityId: resourceEntityId,
      sourceId: source.id,
      name: "Service Database",
      manifestId: "database",
      environment,
      config: {
        ...structuredClone(input.resource.config),
        id: "database",
        name: "Service Database",
        autoDeploy: false,
      },
      runtimeState: initialRuntimeState(),
      archivedAt: null,
      updatedAt: now,
    });
  };
  const connect = (body: unknown) => {
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error("Invalid connection request");
    const request = body as Record<string, unknown>;
    if (
      request.githubInstallationId !== input.installationId ||
      request.repositoryOwner !== "example-inc" ||
      request.repositoryName !== "example-service"
    )
      throw new Error("Repository installation was not found");
    if (!["main", "develop"].includes(String(request.discoveryBranch)))
      throw new Error("Discovery branch was not found");
    if (
      [...input.existing, ...sources].some(
        (source) =>
          source.repositoryOwner === request.repositoryOwner &&
          source.repositoryName === request.repositoryName,
      )
    )
      throw new Error("Repository is already connected");
    if (
      !Array.isArray(request.environments) ||
      request.environments.length === 0
    )
      throw new Error("Select at least one environment");
    const selected = request.environments.map((value) =>
      sourceEnvironmentMappingSchema.parse(value),
    );
    if (
      new Set(selected.map((item) => item.environment)).size !== selected.length
    )
      throw new Error("Duplicate environment");
    for (const item of selected) {
      if (
        !["production", "staging"].includes(item.environment) ||
        !["main", "develop"].includes(item.branch)
      )
        throw new Error("Environment or branch was not found");
    }
    const now = new Date().toISOString();
    const source: Source = {
      id: randomUUID(),
      repositoryOwner: "example-inc",
      repositoryName: "example-service",
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    const connected = selected.map((item) =>
      makeMapping(source.id, item.environment, item.branch),
    );
    for (const environment of connected) {
      materialize(source, environment);
      sync(environment);
    }
    sources.push(source);
    mappings.push(...connected);
    return {
      source,
      syncs: connected.map((environment) => ({
        environment: environment.name,
        syncId: environment.latestSuccessfulSyncId,
        error: null,
      })),
    };
  };
  const mutateEnvironment = (method: string, path: string, body: unknown) => {
    const match = path.match(
      /^\/v1\/core\/sources\/([^/]+)\/environments(?:\/([^/]+))?(?:\/(syncs))?$/,
    );
    const source = sources.find((item) => item.id === match?.[1]);
    if (!source || !match) return undefined;
    if (!["POST", "PATCH", "DELETE"].includes(method)) return undefined;
    const request =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
    if (method === "POST" && !match[2]) {
      const selected = sourceEnvironmentMappingSchema.parse(request);
      if (
        !["production", "staging"].includes(selected.environment) ||
        !["main", "develop"].includes(selected.branch)
      )
        throw new Error("Environment or branch was not found");
      let environment = mappings.find(
        (item) =>
          item.sourceId === source.id && item.name === selected.environment,
      );
      if (environment && !environment.disconnectedAt)
        throw new FixtureEnvironmentError(
          "Environment is already connected",
          409,
        );
      if (environment) {
        environment.disconnectedAt = null;
        environment.branch = selected.branch;
        environment.mappingRevision = randomUUID();
      } else {
        environment = makeMapping(
          source.id,
          selected.environment,
          selected.branch,
        );
        mappings.push(environment);
        materialize(source, environment);
      }
      return { status: 201, body: { environment, sync: sync(environment) } };
    }
    if (method === "POST" && match[2] === "syncs" && !match[3]) {
      const outcomes = mappings
        .filter((item) => item.sourceId === source.id && !item.disconnectedAt)
        .map((environment) => ({
          environmentId: environment.id,
          syncId: sync(environment, true).id,
          error: null,
        }));
      return { status: 202, body: { outcomes } };
    }
    const environment = mappings.find(
      (item) => item.sourceId === source.id && item.id === match[2],
    );
    if (!environment || environment.disconnectedAt)
      throw new FixtureEnvironmentError("Environment was not found", 404);
    if (method === "POST" && match[3] === "syncs")
      return { status: 202, body: { sync: sync(environment, true) } };
    if (match[3] || !["PATCH", "DELETE"].includes(method)) return undefined;
    if (request.expectedRevision !== environment.mappingRevision)
      throw new FixtureEnvironmentError(
        "The environment mapping changed. Refresh before saving.",
        409,
      );
    if (method === "PATCH") {
      const selected = sourceEnvironmentMappingSchema.parse({
        environment: environment.name,
        branch: request.branch,
      });
      if (!["main", "develop"].includes(selected.branch))
        throw new Error("Branch was not found");
      environment.branch = selected.branch;
      environment.mappingRevision = randomUUID();
      return { status: 200, body: { environment, sync: sync(environment) } };
    }
    environment.disconnectedAt = new Date().toISOString();
    environment.mappingRevision = randomUUID();
    return { status: 200, body: { environment } };
  };
  const sync = (environment: Mapping, deployAfterSync = false) => {
    environment.latestSuccessfulSyncId = randomUUID();
    environment.latestSyncFinishedAt = new Date().toISOString();
    for (const app of apps.filter(
      (item) => item.environment?.id === environment.id,
    ))
      app.config.sourceBranch = environment.branch;
    const record = {
      id: environment.latestSuccessfulSyncId,
      sourceId: environment.sourceId,
      environment: { id: environment.id, name: environment.name },
      branch: environment.branch,
      mappingRevision: environment.mappingRevision,
      status: "succeeded" as const,
      commitSha: "c".repeat(40),
      manifestDigest: null,
      reconciliation: null,
      createdAt: environment.latestSyncFinishedAt,
      startedAt: environment.latestSyncFinishedAt,
      finishedAt: environment.latestSyncFinishedAt,
      issues: [],
      deployAfterSync,
    };
    history.unshift(record);
    return record;
  };
  const read = (path: string) => {
    const match = path.match(/^\/v1\/core\/sources\/([^/]+)(?:\/(.*))?$/);
    const source = sources.find((source) => source.id === match?.[1]);
    if (!source) return undefined;
    const child = match?.[2];
    if (!child) return { source, canManageSource: true };
    if (child === "environments")
      return {
        environments: mappings.filter((item) => item.sourceId === source.id),
      };
    if (child === "apps")
      return { apps: apps.filter((item) => item.sourceId === source.id) };
    if (child === "resources")
      return {
        resources: resources.filter((item) => item.sourceId === source.id),
      };
    if (child === "deployments") return { deployments: [] };
    if (child === "capacity") return { capacities: [] };
    if (child === "backups") return { backups: [] };
    if (child === "syncs")
      return { syncs: history.filter((item) => item.sourceId === source.id) };
    return undefined;
  };
  return {
    sources,
    apps,
    resources,
    mappings,
    connect,
    read,
    mutateEnvironment,
  };
}
