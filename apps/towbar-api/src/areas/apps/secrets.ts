import { and, eq, isNull } from "drizzle-orm";

import {
  isNormalizedResource,
  parseSecretReference,
} from "@workspace/towbar-core";
import { apps } from "@workspace/towbar-database/schema";

import { forbidden } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import {
  type EnvironmentSecretMutation,
  type EnvironmentSecretPurpose,
  inspectAwsEnvironmentSecret,
  revealAwsEnvironmentSecret,
  updateAwsEnvironmentSecret,
} from "../aws/service.js";
import { getApp, getResource } from "./queries.js";

import type { NormalizedApp, NormalizedResource } from "@workspace/towbar-core";

export type AppSecretStage =
  "build" | "deployment" | "pre_deploy" | "post_deploy";

export type AppSecretUse = {
  scope: "app" | "shared";
  stage: AppSecretStage;
};

type DeployableSecretRow = {
  config: NormalizedApp | NormalizedResource;
  id: string;
  manifestId: string;
  name: string;
};

export async function listAppSecretBindings(input: {
  appId: string;
  workspaceId: string;
}) {
  return await listDeployableSecretBindings({
    deployableId: input.appId,
    kind: "app",
    workspaceId: input.workspaceId,
  });
}

export async function listResourceSecretBindings(input: {
  resourceId: string;
  workspaceId: string;
}) {
  return await listDeployableSecretBindings({
    deployableId: input.resourceId,
    kind: "resource",
    workspaceId: input.workspaceId,
  });
}

async function listDeployableSecretBindings(input: {
  deployableId: string;
  kind: "app" | "resource";
  workspaceId: string;
}) {
  const deployable = await getSecretBindingOwner(input);
  const deployables = await listSourceDeployables(
    deployable.sourceId,
    input.workspaceId,
  );
  const definitions = buildDeployableSecretBindingDefinitions(
    deployable.config as NormalizedApp | NormalizedResource,
    deployables,
  );
  return await inspectSecretBindingDefinitions({
    definitions,
    sourceId: deployable.sourceId,
    workspaceId: input.workspaceId,
  });
}

export async function listSourceSharedSecretBindings(input: {
  sourceId: string;
  workspaceId: string;
}) {
  const deployables = await listSourceDeployables(
    input.sourceId,
    input.workspaceId,
  );
  return await inspectSecretBindingDefinitions({
    definitions: buildSourceSharedSecretBindingDefinitions(deployables),
    sourceId: input.sourceId,
    workspaceId: input.workspaceId,
  });
}

export async function updateAppSecretBinding(input: {
  appId: string;
  mutation: EnvironmentSecretMutation;
  reference: string;
  workspaceId: string;
}) {
  return await updateDeployableSecretBinding({
    deployableId: input.appId,
    kind: "app",
    mutation: input.mutation,
    reference: input.reference,
    workspaceId: input.workspaceId,
  });
}

export async function updateResourceSecretBinding(input: {
  mutation: EnvironmentSecretMutation;
  reference: string;
  resourceId: string;
  workspaceId: string;
}) {
  return await updateDeployableSecretBinding({
    deployableId: input.resourceId,
    kind: "resource",
    mutation: input.mutation,
    reference: input.reference,
    workspaceId: input.workspaceId,
  });
}

async function updateDeployableSecretBinding(input: {
  deployableId: string;
  kind: "app" | "resource";
  mutation: EnvironmentSecretMutation;
  reference: string;
  workspaceId: string;
}) {
  const deployable = await getSecretBindingOwner(input);
  const uses = collectDeployableSecretUses(
    deployable.config as NormalizedApp | NormalizedResource,
  ).filter((use) => use.reference === input.reference && use.scope === "app");
  if (uses.length === 0) {
    throw forbidden(
      `Only secret references attached to this ${formatDeployableKind(input.kind)} can be edited`,
    );
  }
  const metadata = await updateAwsEnvironmentSecret({
    mutation: input.mutation,
    purpose: secretPurpose(uses),
    secretReference: input.reference,
    sourceId: deployable.sourceId,
    workspaceId: input.workspaceId,
  });
  const deployables = await listSourceDeployables(
    deployable.sourceId,
    input.workspaceId,
  );
  const definition = buildDeployableSecretBindingDefinitions(
    deployable.config as NormalizedApp | NormalizedResource,
    deployables,
  ).find((binding) => binding.reference === input.reference);
  if (!definition) {
    throw new Error("Updated secret binding could not be reconstructed");
  }
  return {
    ...definition,
    ...metadata,
    errorMessage: null,
    status: "available" as const,
  };
}

export async function revealAppSecretBinding(input: {
  appId: string;
  reference: string;
  workspaceId: string;
}) {
  return await revealDeployableSecretBinding({
    deployableId: input.appId,
    kind: "app",
    reference: input.reference,
    workspaceId: input.workspaceId,
  });
}

export async function revealResourceSecretBinding(input: {
  reference: string;
  resourceId: string;
  workspaceId: string;
}) {
  return await revealDeployableSecretBinding({
    deployableId: input.resourceId,
    kind: "resource",
    reference: input.reference,
    workspaceId: input.workspaceId,
  });
}

async function revealDeployableSecretBinding(input: {
  deployableId: string;
  kind: "app" | "resource";
  reference: string;
  workspaceId: string;
}) {
  const deployable = await getSecretBindingOwner(input);
  const uses = collectDeployableSecretUses(
    deployable.config as NormalizedApp | NormalizedResource,
  ).filter((use) => use.reference === input.reference && use.scope === "app");
  if (uses.length === 0) {
    throw forbidden(
      `Only secret references attached to this ${formatDeployableKind(input.kind)} can be revealed`,
    );
  }
  return await revealAwsEnvironmentSecret({
    purpose: secretPurpose(uses),
    secretReference: input.reference,
    sourceId: deployable.sourceId,
    workspaceId: input.workspaceId,
  });
}

export async function updateSourceSharedSecretBinding(input: {
  mutation: EnvironmentSecretMutation;
  reference: string;
  sourceId: string;
  workspaceId: string;
}) {
  const deployables = await listSourceDeployables(
    input.sourceId,
    input.workspaceId,
  );
  const definition = buildSourceSharedSecretBindingDefinitions(
    deployables,
  ).find((binding) => binding.reference === input.reference);
  if (!definition) {
    throw forbidden(
      "Only shared secret references attached to this Source can be edited",
    );
  }
  const metadata = await updateAwsEnvironmentSecret({
    mutation: input.mutation,
    purpose: secretPurpose(definition.uses),
    secretReference: input.reference,
    sourceId: input.sourceId,
    workspaceId: input.workspaceId,
  });
  return {
    ...definition,
    ...metadata,
    errorMessage: null,
    status: "available" as const,
  };
}

export async function revealSourceSharedSecretBinding(input: {
  reference: string;
  sourceId: string;
  workspaceId: string;
}) {
  const deployables = await listSourceDeployables(
    input.sourceId,
    input.workspaceId,
  );
  const definition = buildSourceSharedSecretBindingDefinitions(
    deployables,
  ).find((binding) => binding.reference === input.reference);
  if (!definition) {
    throw forbidden(
      "Only shared secret references attached to this Source can be revealed",
    );
  }
  return await revealAwsEnvironmentSecret({
    purpose: secretPurpose(definition.uses),
    secretReference: input.reference,
    sourceId: input.sourceId,
    workspaceId: input.workspaceId,
  });
}

export function collectDeployableSecretUses(
  config: NormalizedApp | NormalizedResource,
) {
  const uses: Array<AppSecretUse & { reference: string }> = [];
  const add = (
    references: string[],
    scope: AppSecretUse["scope"],
    stage: AppSecretStage,
  ) => {
    for (const reference of references) uses.push({ reference, scope, stage });
  };

  if (!isNormalizedResource(config)) {
    add(config.sharedSecrets?.build ?? [], "shared", "build");
    if (config.secrets.build) add([config.secrets.build], "app", "build");
    if (config.hooks.preDeploy?.secrets) {
      add([config.hooks.preDeploy.secrets], "app", "pre_deploy");
    }
    if (config.hooks.postDeploy?.secrets) {
      add([config.hooks.postDeploy.secrets], "app", "post_deploy");
    }
  }
  add(config.sharedSecrets?.deployment ?? [], "shared", "deployment");
  if (config.secrets.deployment) {
    add([config.secrets.deployment], "app", "deployment");
  }
  return uses;
}

export function buildAppSecretBindingDefinitions(
  app: NormalizedApp,
  deployables: DeployableSecretRow[],
) {
  return buildDeployableSecretBindingDefinitions(app, deployables);
}

export function buildResourceSecretBindingDefinitions(
  resource: NormalizedResource,
  deployables: DeployableSecretRow[],
) {
  return buildDeployableSecretBindingDefinitions(resource, deployables);
}

function buildDeployableSecretBindingDefinitions(
  deployable: NormalizedApp | NormalizedResource,
  deployables: DeployableSecretRow[],
) {
  return buildSecretBindingDefinitions(
    collectDeployableSecretUses(deployable).filter(
      (use) => use.scope === "app",
    ),
    deployables,
  );
}

export function buildSourceSharedSecretBindingDefinitions(
  deployables: DeployableSecretRow[],
) {
  return buildSecretBindingDefinitions(
    deployables.flatMap((deployable) =>
      collectDeployableSecretUses(deployable.config).filter(
        (use) => use.scope === "shared",
      ),
    ),
    deployables,
  );
}

function buildSecretBindingDefinitions(
  activeUses: Array<AppSecretUse & { reference: string }>,
  deployables: DeployableSecretRow[],
) {
  const grouped = new Map<string, AppSecretUse[]>();
  for (const { reference, ...use } of activeUses) {
    const uses = grouped.get(reference) ?? [];
    if (
      !uses.some(
        (candidate) =>
          candidate.scope === use.scope && candidate.stage === use.stage,
      )
    ) {
      uses.push(use);
    }
    grouped.set(reference, uses);
  }

  return [...grouped.entries()]
    .map(([reference, uses]) => {
      const parsed = parseSecretReference(reference);
      return {
        affectedDeployables: deployables
          .flatMap((deployable) => {
            const affectedUses = collectDeployableSecretUses(
              deployable.config,
            ).filter((use) => use.reference === reference);
            if (affectedUses.length === 0) return [];
            return [
              {
                id: deployable.id,
                kind: isNormalizedResource(deployable.config)
                  ? ("resource" as const)
                  : ("app" as const),
                manifestId: deployable.manifestId,
                name: deployable.name,
                uses: affectedUses.map(({ reference: _, ...use }) => use),
              },
            ];
          })
          .sort((left, right) => left.name.localeCompare(right.name)),
        provider: parsed.provider,
        providerReference: parsed.reference,
        reference,
        uses: uses.sort((left, right) =>
          `${left.scope}:${left.stage}`.localeCompare(
            `${right.scope}:${right.stage}`,
          ),
        ),
      };
    })
    .sort((left, right) => left.reference.localeCompare(right.reference));
}

async function inspectSecretBindingDefinitions(input: {
  definitions: ReturnType<typeof buildAppSecretBindingDefinitions>;
  sourceId: string;
  workspaceId: string;
}) {
  return await Promise.all(
    input.definitions.map(async (definition) => {
      try {
        const metadata = await inspectAwsEnvironmentSecret({
          purpose: secretPurpose(definition.uses),
          secretReference: definition.reference,
          sourceId: input.sourceId,
          workspaceId: input.workspaceId,
        });
        return {
          ...definition,
          ...metadata,
          errorMessage: null,
          status: "available" as const,
        };
      } catch {
        return {
          ...definition,
          changedAt: null,
          editable: false,
          errorMessage:
            "Towbar could not read this JSON secret with the Source's AWS credentials.",
          keys: [],
          status: "unavailable" as const,
          versionId: null,
        };
      }
    }),
  );
}

async function listSourceDeployables(
  sourceId: string,
  workspaceId: string,
): Promise<DeployableSecretRow[]> {
  return await getTowbarDatabase()
    .select({
      config: apps.config,
      id: apps.id,
      manifestId: apps.manifestId,
      name: apps.name,
    })
    .from(apps)
    .where(
      and(
        eq(apps.sourceId, sourceId),
        eq(apps.workspaceId, workspaceId),
        isNull(apps.archivedAt),
      ),
    );
}

function secretPurpose(uses: AppSecretUse[]): EnvironmentSecretPurpose {
  return uses.every((use) => use.stage === "build") ? "build" : "deployment";
}

async function getSecretBindingOwner(input: {
  deployableId: string;
  kind: "app" | "resource";
  workspaceId: string;
}) {
  return input.kind === "resource"
    ? await getResource(input.deployableId, input.workspaceId)
    : await getApp(input.deployableId, input.workspaceId);
}

function formatDeployableKind(kind: "app" | "resource") {
  return kind === "resource" ? "Resource" : "App";
}
