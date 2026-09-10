import { randomUUID } from "node:crypto";
import type {
  App,
  AppSecretStage,
  AppSecretsResponse,
  Resource,
} from "@workspace/towbar-web-client";
import { FixtureEnvironmentError } from "./source-connection-fixture.ts";

type Slot = { values: Record<string, string>; revision: string | null };
const stages: AppSecretStage[] = [
  "build",
  "deployment",
  "pre_deploy",
  "post_deploy",
];

export function createDeclaredSecretsFixture(instances: {
  apps: App[];
  resources: Resource[];
}) {
  const slots = new Map<string, Slot>();
  function target(path: string) {
    const match = path.match(
      /^\/v1\/core\/(apps|resources)\/([^/]+)\/secrets(?:\/([^/]+)\/(build|deployment|pre_deploy|post_deploy)(?:\/(reveal|reveal-all))?)?$/,
    );
    if (!match) return;
    const instance = (
      match[1] === "apps" ? instances.apps : instances.resources
    ).find((item) => item.id === match[2]);
    if (!instance?.environment) return;
    const environment = instance.environment.name;
    const environments =
      instance.kind === "app" && instance.config.preview
        ? [environment, `preview:${environment}`]
        : [environment];
    const allowedStages =
      instance.kind === "app" ? stages : ["deployment" as const];
    const declarations = (stage: AppSecretStage) =>
      stage === "deployment"
        ? [instance.kind === "app" ? "DATABASE_URL" : "POSTGRES_PASSWORD"]
        : stage === "build"
          ? ["NPM_TOKEN"]
          : [];
    return { match, instance, environments, allowedStages, declarations };
  }
  function slot(id: string, environment: string, stage: string) {
    const key = `${id}:${environment}:${stage}`;
    let value = slots.get(key);
    if (!value) {
      value = { values: Object.create(null), revision: null };
      slots.set(key, value);
    }
    return value;
  }
  function read(
    path: string,
    selected: string | null,
  ): AppSecretsResponse | undefined {
    const found = target(path);
    if (!found || found.match[3]) return;
    const environment = selected ?? found.environments[0]!;
    if (!found.environments.includes(environment))
      throw new FixtureEnvironmentError("Environment was not found", 404);
    return {
      environments: found.environments,
      canManageSecrets: true,
      bindings: found.allowedStages.map((stage) => {
        const stored = slot(found.instance.id, environment, stage);
        const keys = found.declarations(stage);
        return {
          declared: true,
          environment,
          stage,
          keys,
          missingKeys: keys.filter((key) => !Object.hasOwn(stored.values, key)),
          revision: stored.revision,
          updatedAt: null,
          inheritedKeys: [],
          inheritedOrigins: {},
          inheritedRevisions: { global: null, source: null },
          availableReferences: { globals: [], source: [] },
          pendingChanges: Boolean(stored.revision),
          affectedDeployables: [],
        };
      }),
    };
  }
  function mutate(method: string, path: string, body: unknown) {
    const found = target(path);
    if (!found) return;
    const environment = decodeURIComponent(found.match[3] ?? "");
    const stage = found.match[4] as AppSecretStage;
    if (
      !found.environments.includes(environment) ||
      !found.allowedStages.includes(stage)
    )
      throw new FixtureEnvironmentError("Secret binding was not found", 404);
    const stored = slot(found.instance.id, environment, stage);
    const keys = found.declarations(stage);
    const payload =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
    const action = found.match[5];
    if (method === "POST" && action === "reveal-all")
      return { values: { ...stored.values }, revision: stored.revision };
    if (method === "POST" && action === "reveal") {
      if (
        typeof payload.key !== "string" ||
        !Object.hasOwn(stored.values, payload.key)
      )
        throw new FixtureEnvironmentError("Secret value was not found", 404);
      return { value: stored.values[payload.key], revision: stored.revision };
    }
    if (method !== "PATCH" || action) return;
    if (payload.expectedRevision !== stored.revision)
      throw new FixtureEnvironmentError(
        "These secrets changed after loading. Refresh before saving.",
        409,
      );
    if (
      payload.delete !== undefined &&
      (!Array.isArray(payload.delete) || payload.delete.length)
    )
      throw new FixtureEnvironmentError("Secret keys are managed in YAML", 400);
    if (
      !payload.set ||
      typeof payload.set !== "object" ||
      Array.isArray(payload.set)
    )
      throw new FixtureEnvironmentError("Invalid secret values", 400);
    const entries = Object.entries(payload.set);
    if (
      entries.some(
        ([key, value]) => !keys.includes(key) || typeof value !== "string",
      )
    )
      throw new FixtureEnvironmentError(
        "Only declared secret values can be edited",
        400,
      );
    for (const [key, value] of entries) stored.values[key] = value as string;
    stored.revision = randomUUID();
    return {
      secret: {
        keys,
        revision: stored.revision,
        updatedAt: new Date().toISOString(),
      },
    };
  }
  return { read, mutate, owns: (path: string) => Boolean(target(path)) };
}
