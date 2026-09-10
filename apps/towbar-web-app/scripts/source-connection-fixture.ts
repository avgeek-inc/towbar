import { randomUUID } from "node:crypto";
import { sourceEnvironmentMappingSchema } from "@workspace/towbar-core";
import type { App, Resource, Source } from "@workspace/towbar-web-client";

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
  disconnectedAt: null;
};

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
    const appEntityId = randomUUID(),
      resourceEntityId = randomUUID();
    const connected = selected.map((item) => ({
      id: randomUUID(),
      sourceId: source.id,
      name: item.environment,
      branch: item.branch,
      mappingRevision: randomUUID(),
      previewsEnabled: item.environment === "staging",
      latestSyncStatus: "succeeded" as const,
      latestSyncFinishedAt: now,
      latestSuccessfulSyncId: randomUUID(),
      disconnectedAt: null,
    }));
    for (const environment of connected) {
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
      return {
        syncs: mappings
          .filter((item) => item.sourceId === source.id)
          .map((item) => ({
            id: item.latestSuccessfulSyncId,
            sourceId: source.id,
            environment: { id: item.id, name: item.name, branch: item.branch },
            mappingRevision: item.mappingRevision,
            status: "succeeded",
            createdAt: item.latestSyncFinishedAt,
            startedAt: item.latestSyncFinishedAt,
            finishedAt: item.latestSyncFinishedAt,
            issues: [],
            autoDeploy: false,
          })),
      };
    return undefined;
  };
  return { sources, apps, resources, mappings, connect, read };
}
