import { and, eq, inArray, max } from "drizzle-orm";

import {
  backupOperationResultSchema,
  restoreCleanupResultSchema,
  restoreOperationResultSchema,
} from "@workspace/towbar-core";
import {
  auditEvents,
  deployableRuntimeStates,
  resourceOperationEvents,
  resourceOperations,
} from "@workspace/towbar-database/schema";

import { notFound } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { emitResourceOperationNotification } from "../notifications/events.js";
import { requestServerCheck } from "../servers/service.js";
import { assureResourceBackup } from "./backup-assurance.js";

import type { ResourceOperationResult } from "@workspace/towbar-core";

export async function finishResourceOperation(
  operationId: string,
  input:
    | { result: ResourceOperationResult; state: "succeeded" }
    | {
        errorCode: string;
        errorMessage: string;
        result?: ResourceOperationResult;
        state: "cancelled" | "failed";
      },
) {
  const { changed, operation } = await persistTerminalOperation(
    operationId,
    input,
  );
  // Temporal activity completion can be retried after the database commit.
  // Keep terminal callbacks idempotent so a retry does not duplicate audit
  // entries, notifications, server checks, or backup assurance work.
  if (!changed) return operation;
  await runTerminalSideEffects(operation, input.state);
  return operation;
}

async function persistTerminalOperation(
  operationId: string,
  input:
    | { result: ResourceOperationResult; state: "succeeded" }
    | {
        errorCode: string;
        errorMessage: string;
        result?: ResourceOperationResult;
        state: "cancelled" | "failed";
      },
) {
  return await getTowbarDatabase().transaction(async (transaction) => {
    const [current] = await transaction
      .select()
      .from(resourceOperations)
      .where(eq(resourceOperations.id, operationId))
      .for("update")
      .limit(1);
    if (!current) throw notFound("Resource operation");
    if (["cancelled", "failed", "succeeded"].includes(current.state)) {
      return { changed: false, operation: current };
    }
    const finishedAt = new Date();
    const [updated] = await transaction
      .update(resourceOperations)
      .set({
        errorCode: input.state === "succeeded" ? null : input.errorCode,
        errorMessage: input.state === "succeeded" ? null : input.errorMessage,
        finishedAt,
        phase: terminalRestorePhase(current.type, input.state, current.phase),
        result: input.result ?? null,
        state: input.state,
        updatedAt: finishedAt,
      })
      .where(eq(resourceOperations.id, current.id))
      .returning();
    if (!updated) throw new Error("Unable to finish Resource operation");
    if (current.type === "restore") {
      await insertTerminalRestoreEvent(transaction, current.id, input);
    }
    if (input.state === "succeeded" && current.resourceId) {
      await applySuccessfulResult(transaction, current, input, finishedAt);
    }
    return { changed: true, operation: updated };
  });
}

function terminalRestorePhase(
  type: string,
  state: "cancelled" | "failed" | "succeeded",
  current: (typeof resourceOperations.$inferSelect)["phase"],
) {
  if (type !== "restore") return current;
  return state === "succeeded" ? "succeeded" : state;
}

async function insertTerminalRestoreEvent(
  transaction: Parameters<
    Parameters<ReturnType<typeof getTowbarDatabase>["transaction"]>[0]
  >[0],
  operationId: string,
  input:
    | { result: ResourceOperationResult; state: "succeeded" }
    | {
        errorCode: string;
        errorMessage: string;
        result?: ResourceOperationResult;
        state: "cancelled" | "failed";
      },
) {
  const [latest] = await transaction
    .select({ sequence: max(resourceOperationEvents.sequence) })
    .from(resourceOperationEvents)
    .where(eq(resourceOperationEvents.operationId, operationId));
  const restoreResult = restoreOperationResultSchema.safeParse(input.result);
  await transaction.insert(resourceOperationEvents).values({
    level: input.state === "succeeded" ? "success" : "error",
    message: terminalRestoreMessage(input.state, restoreResult),
    metadata: {},
    operationId,
    phase: input.state,
    sequence: (latest?.sequence ?? 0) + 1,
  });
}

function terminalRestoreMessage(
  state: "cancelled" | "failed" | "succeeded",
  result: ReturnType<typeof restoreOperationResultSchema.safeParse>,
) {
  if (result.success && result.data.outcome === "rolled_back") {
    return "Promotion failed; the previous runtime remains active";
  }
  if (state === "succeeded") return "Restore completed successfully";
  if (state === "cancelled") return "Restore cancelled before promotion";
  return "Restore failed";
}

async function applySuccessfulResult(
  transaction: Parameters<
    Parameters<ReturnType<typeof getTowbarDatabase>["transaction"]>[0]
  >[0],
  operation: typeof resourceOperations.$inferSelect,
  input: { result: ResourceOperationResult; state: "succeeded" },
  finishedAt: Date,
) {
  if (["restart", "start", "stop"].includes(operation.type)) {
    const desiredState = operation.type === "stop" ? "stopped" : "running";
    await transaction
      .insert(deployableRuntimeStates)
      .values({
        appId: operation.resourceId!,
        desiredState,
        updatedAt: finishedAt,
      })
      .onConflictDoUpdate({
        target: deployableRuntimeStates.appId,
        set: { desiredState, updatedAt: finishedAt },
      });
  }
  if (operation.type !== "backup") return;
  const result = backupOperationResultSchema.parse(input.result);
  if (!result.deletedBackupIds.length) return;
  await transaction
    .update(resourceOperations)
    .set({ deletedAt: finishedAt, updatedAt: finishedAt })
    .where(
      and(
        inArray(resourceOperations.id, result.deletedBackupIds),
        eq(resourceOperations.resourceId, operation.resourceId!),
      ),
    );
}

async function runTerminalSideEffects(
  operation: typeof resourceOperations.$inferSelect,
  state: "cancelled" | "failed" | "succeeded",
) {
  if (
    state === "succeeded" &&
    ["cleanup_orphans", "restart", "start", "stop"].includes(operation.type)
  ) {
    await requestServerCheck({
      requestedBy: null,
      serverId: operation.serverId,
      workspaceId: operation.workspaceId,
    }).catch(() => undefined);
  }
  if (operation.state === "failed" && operation.type === "backup") {
    await emitResourceOperationNotification(
      operation.id,
      "backup.failed",
    ).catch(() => undefined);
  }
  if (operation.type === "restore") await finishRestoreSideEffects(operation);
  if (operation.type === "restore_cleanup") {
    await auditRestoreCleanup(operation);
  }
  if (operation.state === "succeeded" && operation.type === "backup") {
    await assureResourceBackup(operation.resourceId!).catch(() => undefined);
  }
}

async function finishRestoreSideEffects(
  operation: typeof resourceOperations.$inferSelect,
) {
  const restoreResult = restoreOperationResultSchema.safeParse(
    operation.result,
  );
  await getTowbarDatabase()
    .insert(auditEvents)
    .values({
      action: `resource.restore.${operation.state}`,
      actorUserId: operation.requestedBy,
      metadata: {
        operationId: operation.id,
        outcome: restoreResult.success ? restoreResult.data.outcome : null,
        reason:
          operation.request.type === "restore"
            ? operation.request.reason
            : null,
      },
      targetId: operation.resourceId,
      targetType: "resource",
      workspaceId: operation.workspaceId,
    });
  const event =
    restoreResult.success && restoreResult.data.outcome === "rolled_back"
      ? "restore.rolled_back"
      : operation.state === "succeeded"
        ? "restore.succeeded"
        : operation.state === "cancelled"
          ? "restore.cancelled"
          : "restore.failed";
  await emitResourceOperationNotification(operation.id, event).catch(
    () => undefined,
  );
}

async function auditRestoreCleanup(
  operation: typeof resourceOperations.$inferSelect,
) {
  const cleanupResult = restoreCleanupResultSchema.safeParse(operation.result);
  await getTowbarDatabase()
    .insert(auditEvents)
    .values({
      action: `resource.restore_cleanup.${operation.state}`,
      actorUserId: operation.requestedBy,
      metadata: {
        cleanedVolumes: cleanupResult.success
          ? cleanupResult.data.cleanedVolumes.length
          : null,
        operationId: operation.id,
        restoreId:
          operation.request.type === "restore_cleanup"
            ? operation.request.restoreId
            : null,
        skippedVolumes: cleanupResult.success
          ? cleanupResult.data.skippedVolumes.length
          : null,
      },
      targetId: operation.resourceId,
      targetType: "resource",
      workspaceId: operation.workspaceId,
    });
}
