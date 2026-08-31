import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import {
  digestValue,
  previewRef,
  previewRuntimeId,
} from "@workspace/towbar-core";
import { deploymentWorkflowId } from "@workspace/towbar-core/temporal";
import type { servers } from "@workspace/towbar-database/schema";
import {
  deployments,
  previewEnvironments,
  releases,
} from "@workspace/towbar-database/schema";

import { getTowbarDatabase } from "../../infrastructure/database.js";
import {
  isPreviewReleaseCurrent,
  previewAdmissionLockKey,
  previewAdmissionReplayAction,
  previewDeploymentIdempotencyKey,
  shouldDeferPreviewAdmission,
} from "./admission-state.js";

import type { NormalizedApp } from "@workspace/towbar-core";

type Transaction = Parameters<
  Parameters<ReturnType<typeof getTowbarDatabase>["transaction"]>[0]
>[0];

export async function admitPreviewDeployment(input: {
  appId: string;
  branch: string;
  commitSha: string;
  config: NormalizedApp;
  deploymentDigest: string;
  hostname: string;
  manifestDigest: string;
  pullRequestNumber: number;
  server: (typeof servers.$inferSelect)["config"];
  serverId: string;
  sourceId: string;
  sourceInputDigest: string | null;
  ttlHours: number;
  workspaceId: string;
}) {
  const database = getTowbarDatabase();
  const gitRef = previewRef(input.pullRequestNumber);
  const runtimeId = previewRuntimeId({
    appId: input.config.id,
    pullRequestNumber: input.pullRequestNumber,
    sourceId: input.sourceId,
  });
  const deploymentId = randomUUID();
  const expiresAt = new Date(Date.now() + input.ttlHours * 60 * 60_000);
  return await database.transaction(async (transaction) => {
    const admissionLockKey = previewAdmissionLockKey({
      appId: input.appId,
      gitRef,
      sourceId: input.sourceId,
    });
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${admissionLockKey}, 0))`,
    );
    const [existingEnvironment] = await transaction
      .select({
        id: previewEnvironments.id,
        latestDeploymentId: previewEnvironments.latestDeploymentId,
        status: previewEnvironments.status,
      })
      .from(previewEnvironments)
      .where(
        and(
          eq(previewEnvironments.sourceId, input.sourceId),
          eq(previewEnvironments.appId, input.appId),
          eq(previewEnvironments.gitRef, gitRef),
        ),
      )
      .for("update")
      .limit(1);
    if (
      existingEnvironment &&
      shouldDeferPreviewAdmission(existingEnvironment.status)
    ) {
      return {
        created: false,
        deferred: true,
        deploymentId: null,
        shouldEnqueue: false,
        environmentId: existingEnvironment.id,
        supersededDeploymentIds: [],
      };
    }
    const [latestDeployment] = existingEnvironment?.latestDeploymentId
      ? await transaction
          .select({
            commitSha: deployments.commitSha,
            deploymentDigest: deployments.deploymentDigest,
            errorCode: deployments.errorCode,
            errorMessage: deployments.errorMessage,
            id: deployments.id,
            state: deployments.state,
          })
          .from(deployments)
          .where(eq(deployments.id, existingEnvironment.latestDeploymentId))
          .limit(1)
      : [];
    if (
      existingEnvironment &&
      latestDeployment?.commitSha === input.commitSha &&
      latestDeployment.deploymentDigest === input.deploymentDigest
    ) {
      const replay = await replayPreviewDeployment(transaction, {
        deployment: latestDeployment,
        environment: existingEnvironment,
        expiresAt,
        input,
        runtimeId,
      });
      if (replay) return replay;
    }
    const reopeningEnvironment =
      existingEnvironment?.status === "deleted" ||
      existingEnvironment?.status === "cleanup_failed";
    const [environment] = await transaction
      .insert(previewEnvironments)
      .values({
        appId: input.appId,
        branch: input.branch,
        expiresAt,
        gitRef,
        hostname: input.hostname,
        latestCommitSha: input.commitSha,
        pullRequestNumber: input.pullRequestNumber,
        runtimeId,
        serverId: input.serverId,
        sourceId: input.sourceId,
        workspaceId: input.workspaceId,
      })
      .onConflictDoUpdate({
        target: [
          previewEnvironments.sourceId,
          previewEnvironments.appId,
          previewEnvironments.gitRef,
        ],
        set: {
          branch: input.branch,
          deletedAt: null,
          errorMessage: null,
          expiresAt,
          hostname: input.hostname,
          latestCommitSha: input.commitSha,
          pullRequestNumber: input.pullRequestNumber,
          runtimeId,
          serverId: input.serverId,
          status: "building",
          updatedAt: new Date(),
        },
      })
      .returning();
    if (!environment)
      throw new Error("Unable to materialize Preview environment");

    const baseIdempotencyKey = previewDeploymentIdempotencyKey({
      commitSha: input.commitSha,
      deploymentDigest: input.deploymentDigest,
      environmentId: environment.id,
    });
    const idempotencyKey = reopeningEnvironment
      ? `${baseIdempotencyKey}:${deploymentId}`
      : baseIdempotencyKey;
    const [existingDeployment] = await transaction
      .select({
        errorCode: deployments.errorCode,
        errorMessage: deployments.errorMessage,
        id: deployments.id,
        state: deployments.state,
      })
      .from(deployments)
      .where(
        and(
          eq(deployments.workspaceId, input.workspaceId),
          eq(deployments.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    if (existingDeployment) {
      const replay = await replayPreviewDeployment(transaction, {
        deployment: existingDeployment,
        environment: {
          id: environment.id,
          status: existingEnvironment?.status ?? environment.status,
        },
        expiresAt,
        input,
        runtimeId,
      });
      if (replay) return replay;
    }

    const [current] = await transaction
      .select({ deploymentDigest: releases.deploymentDigest })
      .from(releases)
      .where(
        and(
          eq(releases.previewEnvironmentId, environment.id),
          eq(releases.status, "current"),
        ),
      )
      .limit(1);
    if (
      !reopeningEnvironment &&
      isPreviewReleaseCurrent(current?.deploymentDigest, input.deploymentDigest)
    ) {
      await transaction
        .update(previewEnvironments)
        .set({ status: "healthy", updatedAt: new Date() })
        .where(eq(previewEnvironments.id, environment.id));
      return {
        created: false,
        deferred: false,
        deploymentId: null,
        environmentId: environment.id,
        shouldEnqueue: false,
        supersededDeploymentIds: [],
      };
    }

    const now = new Date();
    const supersededDeployments = await transaction
      .update(deployments)
      .set({
        errorCode: "PREVIEW_SUPERSEDED",
        errorMessage: "Superseded by a newer Preview commit",
        finishedAt: now,
        state: "skipped",
        updatedAt: now,
      })
      .where(
        and(
          eq(deployments.previewEnvironmentId, environment.id),
          eq(deployments.state, "queued"),
        ),
      )
      .returning({ id: deployments.id });
    const [insertedDeployment] = await transaction
      .insert(deployments)
      .values({
        appId: input.appId,
        appSnapshot: input.config,
        commitSha: input.commitSha,
        configDigest: digestValue(input.config),
        deployableKind: "app",
        deploymentDigest: input.deploymentDigest,
        environment: "preview",
        gitRef,
        hostname: input.hostname,
        id: deploymentId,
        idempotencyKey,
        manifestDigest: input.manifestDigest,
        previewEnvironmentId: environment.id,
        requestedBy: null,
        serverId: input.serverId,
        serverSnapshot: input.server,
        sourceId: input.sourceId,
        sourceInputDigest: input.sourceInputDigest,
        temporalWorkflowId: deploymentWorkflowId(deploymentId),
        workspaceId: input.workspaceId,
      })
      .onConflictDoNothing({
        target: [deployments.workspaceId, deployments.idempotencyKey],
      })
      .returning({ id: deployments.id });
    if (!insertedDeployment) {
      const [acceptedDeployment] = await transaction
        .select({
          errorCode: deployments.errorCode,
          errorMessage: deployments.errorMessage,
          id: deployments.id,
          state: deployments.state,
        })
        .from(deployments)
        .where(
          and(
            eq(deployments.workspaceId, input.workspaceId),
            eq(deployments.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      if (!acceptedDeployment) {
        throw new Error("Unable to recover idempotent Preview admission");
      }
      const replay = await replayPreviewDeployment(transaction, {
        deployment: acceptedDeployment,
        environment,
        expiresAt,
        input,
        runtimeId,
      });
      if (!replay)
        throw new Error("Unable to recover active Preview admission");
      return replay;
    }
    await transaction
      .update(previewEnvironments)
      .set({ latestDeploymentId: deploymentId, updatedAt: now })
      .where(eq(previewEnvironments.id, environment.id));
    return {
      created: true,
      deferred: false,
      deploymentId,
      environmentId: environment.id,
      shouldEnqueue: true,
      supersededDeploymentIds: supersededDeployments.map(
        (deployment) => deployment.id,
      ),
    };
  });
}

async function replayPreviewDeployment(
  transaction: Transaction,
  replay: {
    deployment: Pick<
      typeof deployments.$inferSelect,
      "errorCode" | "errorMessage" | "id" | "state"
    >;
    environment: Pick<typeof previewEnvironments.$inferSelect, "id" | "status">;
    expiresAt: Date;
    input: {
      branch: string;
      commitSha: string;
      hostname: string;
      pullRequestNumber: number;
      serverId: string;
    };
    runtimeId: string;
  },
) {
  const action = previewAdmissionReplayAction({
    deploymentErrorCode: replay.deployment.errorCode,
    deploymentState: replay.deployment.state,
    environmentStatus: replay.environment.status,
  });
  if (action === "replace") return null;
  const now = new Date();
  if (action === "reset_and_enqueue") {
    await transaction
      .update(deployments)
      .set({
        errorCode: null,
        errorMessage: null,
        finishedAt: null,
        startedAt: null,
        state: "queued",
        updatedAt: now,
      })
      .where(eq(deployments.id, replay.deployment.id));
  }
  const succeeded = ["succeeded", "succeeded_with_warnings"].includes(
    replay.deployment.state,
  );
  await transaction
    .update(previewEnvironments)
    .set({
      branch: replay.input.branch,
      deletedAt: null,
      errorMessage:
        action === "reuse" && !succeeded
          ? replay.deployment.errorMessage
          : null,
      expiresAt: replay.expiresAt,
      hostname: replay.input.hostname,
      latestCommitSha: replay.input.commitSha,
      latestDeploymentId: replay.deployment.id,
      pullRequestNumber: replay.input.pullRequestNumber,
      runtimeId: replay.runtimeId,
      serverId: replay.input.serverId,
      status:
        action === "reuse" ? (succeeded ? "healthy" : "failed") : "building",
      updatedAt: now,
    })
    .where(eq(previewEnvironments.id, replay.environment.id));
  return {
    created: false,
    deferred: false,
    deploymentId: replay.deployment.id,
    environmentId: replay.environment.id,
    shouldEnqueue: action !== "reuse",
    supersededDeploymentIds: [],
  };
}
