import { and, eq, isNull } from "drizzle-orm";

import { backupOperationResultSchema } from "@workspace/towbar-core";
import {
  resourceOperations,
  sshHostKeys,
} from "@workspace/towbar-database/schema";

import { conflict, notFound } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { getDecryptedAwsCredential, resolveAwsSecret } from "../aws/service.js";
import { resolveRuntimeEnvironmentSecrets } from "../deployments/deployment-secrets.js";
import { sshLoginSecretSchema } from "../servers/service.js";
import { getCleanupExpected, getRetentionBackups } from "./queries.js";

export async function getOperationExecutionContext(operationId: string) {
  const [operation] = await getTowbarDatabase()
    .select()
    .from(resourceOperations)
    .where(eq(resourceOperations.id, operationId))
    .limit(1);
  if (!operation) throw notFound("Resource operation");
  if (operation.state === "queued") {
    await getTowbarDatabase()
      .update(resourceOperations)
      .set({ startedAt: new Date(), state: "running", updatedAt: new Date() })
      .where(
        and(
          eq(resourceOperations.id, operationId),
          eq(resourceOperations.state, "queued"),
        ),
      );
  } else if (operation.state !== "running") {
    throw conflict("Resource operation is already complete");
  }
  const trustedHostKeys = await getTowbarDatabase()
    .select({
      algorithm: sshHostKeys.algorithm,
      fingerprint: sshHostKeys.fingerprint,
      publicKey: sshHostKeys.publicKey,
    })
    .from(sshHostKeys)
    .where(
      and(
        eq(sshHostKeys.serverId, operation.serverId),
        isNull(sshHostKeys.revokedAt),
      ),
    );
  const currentRelease =
    operation.request.type === "cleanup_orphans"
      ? null
      : operation.request.release;
  const cleanupExpected = await getCleanupExpected(operation.serverId);
  const restoreBackup =
    operation.request.type === "restore" && operation.resourceId
      ? await getRestoreBackup({
          backupId: operation.request.backupId,
          resourceId: operation.resourceId,
          sourceId: operation.sourceId,
          workspaceId: operation.workspaceId,
        })
      : null;
  return {
    cleanupExpected,
    currentRelease,
    deployable: operation.appSnapshot,
    deployableId: operation.resourceId,
    operationId: operation.id,
    request: operation.request,
    retentionBackups:
      operation.request.type === "backup" && operation.resourceId
        ? await getRetentionBackups(operation.resourceId, operation.appSnapshot)
        : [],
    restoreBackup,
    server: operation.serverSnapshot,
    sourceId: operation.sourceId,
    trustedHostKeys,
  };
}

export async function resolveOperationSecrets(operationId: string) {
  const [operation] = await getTowbarDatabase()
    .select({
      app: resourceOperations.appSnapshot,
      request: resourceOperations.request,
      resourceId: resourceOperations.resourceId,
      server: resourceOperations.serverSnapshot,
      sourceId: resourceOperations.sourceId,
      workspaceId: resourceOperations.workspaceId,
    })
    .from(resourceOperations)
    .where(eq(resourceOperations.id, operationId))
    .limit(1);
  if (!operation) throw notFound("Resource operation");
  const login = sshLoginSecretSchema.parse(
    await resolveAwsSecret({
      secretReference: operation.server.secrets.login,
      sourceId: operation.sourceId,
      workspaceId: operation.workspaceId,
    }),
  );
  const runtime =
    ["capture_logs", "restore"].includes(operation.request.type) &&
    operation.app
      ? await resolveRuntimeEnvironmentSecrets({
          app: operation.app,
          sourceId: operation.sourceId,
          workspaceId: operation.workspaceId,
        })
      : {};
  const requiresAws = ["backup", "restore"].includes(operation.request.type);
  const awsCredential = requiresAws
    ? await getDecryptedAwsCredential({
        sourceId: operation.sourceId,
        workspaceId: operation.workspaceId,
      })
    : null;
  return {
    aws: awsCredential
      ? { ...awsCredential.payload, region: awsCredential.region }
      : null,
    login,
    runtime,
    sensitiveValues: [
      login.privateKey,
      ...(awsCredential ? [awsCredential.payload.secretAccessKey] : []),
      ...Object.values(runtime),
    ],
  };
}

async function getRestoreBackup(input: {
  backupId: string;
  resourceId: string;
  sourceId: string;
  workspaceId: string;
}) {
  const [backup] = await getTowbarDatabase()
    .select({
      createdAt: resourceOperations.createdAt,
      id: resourceOperations.id,
      result: resourceOperations.result,
    })
    .from(resourceOperations)
    .where(
      and(
        eq(resourceOperations.id, input.backupId),
        eq(resourceOperations.resourceId, input.resourceId),
        eq(resourceOperations.sourceId, input.sourceId),
        eq(resourceOperations.workspaceId, input.workspaceId),
        eq(resourceOperations.type, "backup"),
        eq(resourceOperations.state, "succeeded"),
        isNull(resourceOperations.deletedAt),
      ),
    )
    .limit(1);
  if (!backup) throw notFound("Retained backup");
  return {
    createdAt: backup.createdAt.toISOString(),
    id: backup.id,
    result: backupOperationResultSchema.parse(backup.result),
  };
}
