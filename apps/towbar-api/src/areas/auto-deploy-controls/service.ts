import { and, eq } from "drizzle-orm";

import {
  defaultAutoDeployCircuit,
  evaluateMaintenanceWindow,
  validateAutoDeployMaintenanceWindow,
} from "@workspace/towbar-core";
import {
  apps,
  auditEvents,
  deployments,
  sources,
} from "@workspace/towbar-database/schema";

import { conflict, notFound } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import {
  getActor,
  listSourceControlEvents,
  listTargetControlEvents,
} from "./audit.js";
import { nextCircuitAfterFailure, nextCircuitAfterSuccess } from "./circuit.js";

import type {
  AutoDeployBlockReason,
  AutoDeployCircuit,
  AutoDeployControl,
  AutoDeployMaintenanceWindow,
  AutoDeployRecoveryPolicy,
  DeferredAutomaticDeployment,
} from "@workspace/towbar-core";

export type AutoDeployControlPatch = {
  failureThreshold?: number;
  maintenanceWindow?: AutoDeployMaintenanceWindow | null;
  paused?: boolean;
  pauseReason?: string | null;
  recoverCircuit?: boolean;
  recoveryPolicy?: AutoDeployRecoveryPolicy;
};

export type AutoDeployGate =
  | { blocked: false; nextOpenAt: null; reason: null; scope: null }
  | {
      blocked: true;
      nextOpenAt: string | null;
      reason: AutoDeployBlockReason;
      scope: "deployable" | "source";
    };

export function evaluateAutoDeployGate(input: {
  circuit?: AutoDeployCircuit;
  deployableControl?: AutoDeployControl;
  now?: Date;
  sourceControl: AutoDeployControl;
}): AutoDeployGate {
  const now = input.now ?? new Date();
  if (input.sourceControl.paused) {
    return {
      blocked: true,
      nextOpenAt: null,
      reason: "paused",
      scope: "source",
    };
  }
  if (input.deployableControl?.paused) {
    return {
      blocked: true,
      nextOpenAt: null,
      reason: "paused",
      scope: "deployable",
    };
  }
  const sourceWindow = evaluateMaintenanceWindow(
    input.sourceControl.maintenanceWindow,
    now,
  );
  if (!sourceWindow.open) {
    return {
      blocked: true,
      nextOpenAt: sourceWindow.nextOpenAt,
      reason: "maintenance_window",
      scope: "source",
    };
  }
  if (input.deployableControl) {
    const deployableWindow = evaluateMaintenanceWindow(
      input.deployableControl.maintenanceWindow,
      now,
    );
    if (!deployableWindow.open) {
      return {
        blocked: true,
        nextOpenAt: deployableWindow.nextOpenAt,
        reason: "maintenance_window",
        scope: "deployable",
      };
    }
  }
  if (input.circuit?.openedAt) {
    return {
      blocked: true,
      nextOpenAt: null,
      reason: "circuit_open",
      scope: "deployable",
    };
  }
  return { blocked: false, nextOpenAt: null, reason: null, scope: null };
}

export async function getSourceAutoDeployControl(
  sourceId: string,
  workspaceId: string,
) {
  const [source] = await getTowbarDatabase()
    .select({
      control: sources.autoDeployControl,
      id: sources.id,
    })
    .from(sources)
    .where(and(eq(sources.id, sourceId), eq(sources.workspaceId, workspaceId)))
    .limit(1);
  if (!source) throw notFound("Source");
  const gate = evaluateAutoDeployGate({ sourceControl: source.control });
  return {
    control: source.control,
    effective: await describeGate({
      gate,
      sourceControl: source.control,
    }),
    recentEvents: await listSourceControlEvents(sourceId, workspaceId),
  };
}

export async function getDeployableAutoDeployControl(input: {
  deployableId: string;
  expectedType: "app" | "resource";
  workspaceId: string;
}) {
  const target = await loadDeployableControl(input);
  const gate = evaluateAutoDeployGate({
    circuit: target.circuit,
    deployableControl: target.control,
    sourceControl: target.sourceControl,
  });
  return {
    circuit: target.circuit,
    control: target.control,
    effective: await describeGate({
      deployableControl: target.control,
      gate,
      pending: target.pending,
      sourceControl: target.sourceControl,
    }),
    manifestAutoDeployEnabled: Boolean(target.config.autoDeploy),
    recentEvents: await listTargetControlEvents(
      input.deployableId,
      input.workspaceId,
    ),
  };
}

export async function updateSourceAutoDeployControl(input: {
  actorUserId: string;
  patch: AutoDeployControlPatch;
  sourceId: string;
  workspaceId: string;
}) {
  const result = await getTowbarDatabase().transaction(async (transaction) => {
    const [source] = await transaction
      .select({ control: sources.autoDeployControl, id: sources.id })
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
    const control = applyControlPatch(
      source.control,
      input.patch,
      input.actorUserId,
    );
    const now = new Date();
    await transaction
      .update(sources)
      .set({ autoDeployControl: control, updatedAt: now })
      .where(eq(sources.id, source.id));
    await transaction.insert(auditEvents).values({
      action: "auto_deploy.control_updated",
      actorUserId: input.actorUserId,
      metadata: controlAuditMetadata(source.control, control),
      targetId: source.id,
      targetType: "source",
      workspaceId: input.workspaceId,
    });
    return {
      shouldReevaluate:
        (source.control.paused && !control.paused) ||
        maintenanceWindowChanged(
          source.control.maintenanceWindow,
          control.maintenanceWindow,
        ),
    };
  });
  return {
    ...(await getSourceAutoDeployControl(input.sourceId, input.workspaceId)),
    shouldReevaluate: result.shouldReevaluate,
  };
}

export async function updateDeployableAutoDeployControl(input: {
  actorUserId: string;
  deployableId: string;
  expectedType: "app" | "resource";
  patch: AutoDeployControlPatch;
  workspaceId: string;
}) {
  const result = await getTowbarDatabase().transaction(async (transaction) => {
    const [target] = await transaction
      .select({
        circuit: apps.autoDeployCircuit,
        control: apps.autoDeployControl,
        id: apps.id,
        kind: apps.kind,
      })
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
    const control = applyControlPatch(
      target.control,
      input.patch,
      input.actorUserId,
    );
    const circuit = input.patch.recoverCircuit
      ? defaultAutoDeployCircuit
      : target.circuit;
    const now = new Date();
    await transaction
      .update(apps)
      .set({
        autoDeployCircuit: circuit,
        autoDeployControl: control,
        updatedAt: now,
      })
      .where(eq(apps.id, target.id));
    await transaction.insert(auditEvents).values({
      action: "auto_deploy.control_updated",
      actorUserId: input.actorUserId,
      metadata: controlAuditMetadata(target.control, control),
      targetId: target.id,
      targetType: input.expectedType,
      workspaceId: input.workspaceId,
    });
    if (input.patch.recoverCircuit && target.circuit.openedAt) {
      await transaction.insert(auditEvents).values({
        action: "auto_deploy.circuit_recovered",
        actorUserId: input.actorUserId,
        metadata: {
          previousFailureCount: target.circuit.consecutiveFailures,
          recoveryPolicy: control.recoveryPolicy,
        },
        targetId: target.id,
        targetType: input.expectedType,
        workspaceId: input.workspaceId,
      });
    }
    return {
      shouldReevaluate:
        (target.control.paused && !control.paused) ||
        Boolean(input.patch.recoverCircuit) ||
        maintenanceWindowChanged(
          target.control.maintenanceWindow,
          control.maintenanceWindow,
        ),
    };
  });
  return {
    ...(await getDeployableAutoDeployControl(input)),
    shouldReevaluate: result.shouldReevaluate,
  };
}

export async function requireManualAutoDeployBypass(input: {
  actorUserId: string;
  bypass: boolean;
  deployableId: string;
  workspaceId: string;
}) {
  const [target] = await getTowbarDatabase()
    .select({
      circuit: apps.autoDeployCircuit,
      control: apps.autoDeployControl,
      kind: apps.kind,
      sourceControl: sources.autoDeployControl,
      sourceId: apps.sourceId,
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
  if (!target) throw notFound("App");
  const gate = evaluateAutoDeployGate({
    circuit: target.circuit,
    deployableControl: target.control,
    sourceControl: target.sourceControl,
  });
  if (!gate.blocked) return;
  if (!input.bypass) {
    throw conflict(
      "Automatic deployment admission is currently blocked. Confirm the manual bypass to deploy anyway.",
      "AUTO_DEPLOY_CONTROL_ACTIVE",
    );
  }
  await getTowbarDatabase()
    .insert(auditEvents)
    .values({
      action: "auto_deploy.manual_bypass",
      actorUserId: input.actorUserId,
      metadata: { reason: gate.reason, scope: gate.scope },
      targetId: input.deployableId,
      targetType: target.kind === "app" ? "app" : "resource",
      workspaceId: input.workspaceId,
    });
}

export async function recordAutoDeployCircuitOutcome(input: {
  deploymentId: string;
  state: "failed" | "succeeded" | "succeeded_with_warnings";
}) {
  await getTowbarDatabase().transaction(async (transaction) => {
    const [deployment] = await transaction
      .select({
        appId: deployments.appId,
        deployableKind: deployments.deployableKind,
        environment: deployments.environment,
        errorCode: deployments.errorCode,
        requestedBy: deployments.requestedBy,
        workspaceId: deployments.workspaceId,
      })
      .from(deployments)
      .where(eq(deployments.id, input.deploymentId))
      .limit(1);
    if (!deployment || deployment.environment !== "production") return;
    const [target] = await transaction
      .select({
        circuit: apps.autoDeployCircuit,
        control: apps.autoDeployControl,
      })
      .from(apps)
      .where(eq(apps.id, deployment.appId))
      .for("update")
      .limit(1);
    if (!target) return;

    if (input.state === "failed") {
      const fingerprint = deployment.errorCode ?? "DEPLOYMENT_FAILED";
      const outcome = nextCircuitAfterFailure({
        circuit: target.circuit,
        failureFingerprint: fingerprint,
        failureThreshold: target.control.failureThreshold,
      });
      await transaction
        .update(apps)
        .set({ autoDeployCircuit: outcome.circuit, updatedAt: new Date() })
        .where(eq(apps.id, deployment.appId));
      if (outcome.opened) {
        await transaction.insert(auditEvents).values({
          action: "auto_deploy.circuit_opened",
          actorUserId: null,
          metadata: {
            failureCount: outcome.circuit.consecutiveFailures,
            fingerprint,
            threshold: target.control.failureThreshold,
          },
          targetId: deployment.appId,
          targetType: deployment.deployableKind === "app" ? "app" : "resource",
          workspaceId: deployment.workspaceId,
        });
      }
      return;
    }

    const outcome = nextCircuitAfterSuccess({
      circuit: target.circuit,
      manualDeployment: Boolean(deployment.requestedBy),
      recoveryPolicy: target.control.recoveryPolicy,
    });
    await transaction
      .update(apps)
      .set({ autoDeployCircuit: outcome.circuit, updatedAt: new Date() })
      .where(eq(apps.id, deployment.appId));
    if (outcome.recovered) {
      await transaction.insert(auditEvents).values({
        action: "auto_deploy.circuit_recovered",
        actorUserId: deployment.requestedBy,
        metadata: { recoveryPolicy: target.control.recoveryPolicy },
        targetId: deployment.appId,
        targetType: deployment.deployableKind === "app" ? "app" : "resource",
        workspaceId: deployment.workspaceId,
      });
    }
  });
}

export function createDeferredAutomaticDeployment(input: {
  commitSha: string;
  deploymentDigest: string;
  gate: Extract<AutoDeployGate, { blocked: true }>;
  manifestId: string;
  now?: Date;
}): DeferredAutomaticDeployment {
  return {
    commitSha: input.commitSha,
    deploymentDigest: input.deploymentDigest,
    deferredAt: (input.now ?? new Date()).toISOString(),
    manifestId: input.manifestId,
    nextEligibleAt: input.gate.nextOpenAt,
    reason: input.gate.reason,
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
      circuit: apps.autoDeployCircuit,
      config: apps.config,
      control: apps.autoDeployControl,
      kind: apps.kind,
      pending: apps.deferredAutomaticDeployment,
      sourceControl: sources.autoDeployControl,
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

function applyControlPatch(
  current: AutoDeployControl,
  patch: AutoDeployControlPatch,
  actorUserId: string,
) {
  if (patch.maintenanceWindow) {
    validateAutoDeployMaintenanceWindow(patch.maintenanceWindow);
  }
  const now = new Date().toISOString();
  const paused = patch.paused ?? current.paused;
  return {
    ...current,
    failureThreshold: patch.failureThreshold ?? current.failureThreshold,
    maintenanceWindow:
      patch.maintenanceWindow === undefined
        ? current.maintenanceWindow
        : patch.maintenanceWindow,
    paused,
    pausedAt: paused
      ? current.paused && current.pausedAt
        ? current.pausedAt
        : now
      : null,
    pausedBy: paused
      ? current.paused && current.pausedBy
        ? current.pausedBy
        : actorUserId
      : null,
    pauseReason: paused
      ? (patch.pauseReason ?? current.pauseReason ?? "Paused by operator")
      : null,
    recoveryPolicy: patch.recoveryPolicy ?? current.recoveryPolicy,
    updatedAt: now,
    updatedBy: actorUserId,
  } satisfies AutoDeployControl;
}

function matchesExpectedType(
  kind: "app" | "image" | "postgres" | "redis",
  expected: "app" | "resource",
) {
  return expected === "app" ? kind === "app" : kind !== "app";
}

function controlAuditMetadata(
  previous: AutoDeployControl,
  next: AutoDeployControl,
) {
  return {
    failureThreshold: next.failureThreshold,
    maintenanceWindowChanged: maintenanceWindowChanged(
      previous.maintenanceWindow,
      next.maintenanceWindow,
    ),
    paused: next.paused,
    pauseReason: next.pauseReason,
    recoveryPolicy: next.recoveryPolicy,
  };
}

function maintenanceWindowChanged(
  previous: AutoDeployMaintenanceWindow | null,
  next: AutoDeployMaintenanceWindow | null,
) {
  return JSON.stringify(previous) !== JSON.stringify(next);
}

async function describeGate(input: {
  deployableControl?: AutoDeployControl;
  gate: AutoDeployGate;
  pending?: DeferredAutomaticDeployment | null;
  sourceControl: AutoDeployControl;
}) {
  const actorId = input.gate.blocked
    ? input.gate.scope === "source"
      ? (input.sourceControl.pausedBy ?? input.sourceControl.updatedBy)
      : input.gate.reason === "circuit_open"
        ? null
        : (input.deployableControl?.pausedBy ??
          input.deployableControl?.updatedBy)
    : null;
  const actor = actorId ? await getActor(actorId) : null;
  const reasonDetail = !input.gate.blocked
    ? null
    : input.gate.reason === "circuit_open"
      ? "Comparable deployment failures opened the circuit"
      : input.gate.reason === "maintenance_window"
        ? "Outside the configured maintenance window"
        : input.gate.scope === "source"
          ? input.sourceControl.pauseReason
          : input.deployableControl?.pauseReason;
  return {
    actor,
    blocked: input.gate.blocked,
    nextOpenAt: input.gate.nextOpenAt,
    pending: input.pending ?? null,
    reason: input.gate.reason,
    reasonDetail,
    scope: input.gate.scope,
  };
}
