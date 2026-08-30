import { and, eq } from "drizzle-orm";

import { evaluateAutoDeployPause } from "@workspace/towbar-core";
import { apps, sources } from "@workspace/towbar-database/schema";

import { notFound } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";

import type {
  AutoDeployPauseGate,
  DeferredAutomaticDeployment,
} from "@workspace/towbar-core";

export async function getSourceAutoDeployControl(
  sourceId: string,
  workspaceId: string,
) {
  const [source] = await getTowbarDatabase()
    .select({ paused: sources.autoDeployPaused })
    .from(sources)
    .where(and(eq(sources.id, sourceId), eq(sources.workspaceId, workspaceId)))
    .limit(1);
  if (!source) throw notFound("Source");
  return {
    effective: {
      ...evaluateAutoDeployPause({ sourcePaused: source.paused }),
      pending: null,
    },
    paused: source.paused,
  };
}

export async function getDeployableAutoDeployControl(input: {
  deployableId: string;
  expectedType: "app" | "resource";
  workspaceId: string;
}) {
  const target = await loadDeployableControl(input);
  return {
    effective: {
      ...evaluateAutoDeployPause({
        deployablePaused: target.paused,
        sourcePaused: target.sourcePaused,
      }),
      pending: target.pending,
    },
    manifestAutoDeployEnabled: Boolean(target.config.autoDeploy),
    paused: target.paused,
  };
}

export async function updateSourceAutoDeployControl(input: {
  paused: boolean;
  sourceId: string;
  workspaceId: string;
}) {
  const shouldReevaluate = await getTowbarDatabase().transaction(
    async (transaction) => {
      const [source] = await transaction
        .select({ id: sources.id, paused: sources.autoDeployPaused })
        .from(sources)
        .where(
          and(
            eq(sources.id, input.sourceId),
            eq(sources.workspaceId, input.workspaceId),
          ),
        )
        .for("update")
        .limit(1);
      if (!source) throw notFound("Source");
      await transaction
        .update(sources)
        .set({ autoDeployPaused: input.paused, updatedAt: new Date() })
        .where(eq(sources.id, source.id));
      return source.paused && !input.paused;
    },
  );
  return {
    ...(await getSourceAutoDeployControl(input.sourceId, input.workspaceId)),
    shouldReevaluate,
  };
}

export async function updateDeployableAutoDeployControl(input: {
  deployableId: string;
  expectedType: "app" | "resource";
  paused: boolean;
  workspaceId: string;
}) {
  const shouldReevaluate = await getTowbarDatabase().transaction(
    async (transaction) => {
      const [target] = await transaction
        .select({ id: apps.id, kind: apps.kind, paused: apps.autoDeployPaused })
        .from(apps)
        .where(
          and(
            eq(apps.id, input.deployableId),
            eq(apps.workspaceId, input.workspaceId),
          ),
        )
        .for("update")
        .limit(1);
      if (!target || !matchesExpectedType(target.kind, input.expectedType)) {
        throw notFound(input.expectedType === "app" ? "App" : "Resource");
      }
      await transaction
        .update(apps)
        .set({ autoDeployPaused: input.paused, updatedAt: new Date() })
        .where(eq(apps.id, target.id));
      return target.paused && !input.paused;
    },
  );
  return {
    ...(await getDeployableAutoDeployControl(input)),
    shouldReevaluate,
  };
}

export function createDeferredAutomaticDeployment(input: {
  commitSha: string;
  deploymentDigest: string;
  gate: Extract<AutoDeployPauseGate, { paused: true }>;
  manifestId: string;
  now?: Date;
}): DeferredAutomaticDeployment {
  return {
    commitSha: input.commitSha,
    deploymentDigest: input.deploymentDigest,
    deferredAt: (input.now ?? new Date()).toISOString(),
    manifestId: input.manifestId,
    reason: "paused",
    scope: input.gate.scope,
  };
}

async function loadDeployableControl(input: {
  deployableId: string;
  expectedType: "app" | "resource";
  workspaceId: string;
}) {
  const [target] = await getTowbarDatabase()
    .select({
      config: apps.config,
      kind: apps.kind,
      paused: apps.autoDeployPaused,
      pending: apps.deferredAutomaticDeployment,
      sourcePaused: sources.autoDeployPaused,
    })
    .from(apps)
    .innerJoin(sources, eq(sources.id, apps.sourceId))
    .where(
      and(
        eq(apps.id, input.deployableId),
        eq(apps.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);
  if (!target || !matchesExpectedType(target.kind, input.expectedType)) {
    throw notFound(input.expectedType === "app" ? "App" : "Resource");
  }
  return target;
}

function matchesExpectedType(
  kind: "app" | "image" | "postgres" | "redis",
  expected: "app" | "resource",
) {
  return expected === "app" ? kind === "app" : kind !== "app";
}
