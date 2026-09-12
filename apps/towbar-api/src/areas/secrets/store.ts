import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  applySecretMutation,
  decryptCredential,
  encryptCredential,
  parseCredentialsMasterKey,
  requiredKeysForStage,
  validateSecretObject,
} from "@workspace/towbar-core";
import {
  apps,
  auditEvents,
  managedSecrets,
  servers,
  sourceEnvironments,
  sources,
  workspaces,
} from "@workspace/towbar-database/schema";
import { getEnv } from "../../env.js";
import { conflict, notFound, unprocessable } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import type { SecretMutation } from "@workspace/towbar-core";

export type SecretDatabase = Pick<
  ReturnType<typeof getTowbarDatabase>,
  "select" | "insert" | "update" | "execute"
>;
export type SecretOwner = { workspaceId: string } & (
  | { type: "workspace" }
  | { type: "source"; id: string }
  | { type: "app"; id: string }
  | { type: "server"; id: string }
);
export type SecretSlot = SecretOwner & {
  environment: string;
  stage: string;
};
export const ownerKey = (owner: SecretOwner) =>
  owner.type === "workspace"
    ? `workspace:${owner.workspaceId}`
    : `${owner.type}:${owner.id}`;
export const slotKey = (slot: SecretSlot) =>
  `${slot.workspaceId}:${ownerKey(slot)}:${slot.environment}:${slot.stage}`;

export async function requireSecretOwner(
  owner: SecretOwner,
  database: SecretDatabase = getTowbarDatabase(),
) {
  if (owner.type === "workspace") {
    const [workspace] = await database
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, owner.workspaceId))
      .limit(1);
    if (!workspace) throw notFound("Workspace");
    return { sourceId: null, appId: null, serverId: null };
  }
  const table =
    owner.type === "source" ? sources : owner.type === "app" ? apps : servers;
  const [row] = await database
    .select()
    .from(table)
    .where(
      and(
        eq(table.id, owner.id),
        eq(table.workspaceId, owner.workspaceId),
        owner.type === "server" ? isNull(servers.archivedAt) : undefined,
      ),
    )
    .limit(1);
  if (!row) throw notFound(owner.type);
  return {
    sourceId:
      owner.type === "source"
        ? owner.id
        : owner.type === "app"
          ? (row as typeof apps.$inferSelect).sourceId
          : null,
    appId: owner.type === "app" ? owner.id : null,
    serverId: owner.type === "server" ? owner.id : null,
  };
}

export function secretSlotFilter(slot: SecretSlot) {
  return and(
    eq(managedSecrets.workspaceId, slot.workspaceId),
    eq(managedSecrets.owner, ownerKey(slot)),
    eq(managedSecrets.environment, slot.environment),
    eq(managedSecrets.stage, slot.stage),
  );
}

async function declaredKeysForSlot(slot: SecretSlot, database: SecretDatabase) {
  if (slot.type !== "app") return null;
  const [instance] = await database
    .select({
      declarations: apps.requiredSecrets,
      environment: sourceEnvironments.name,
    })
    .from(apps)
    .innerJoin(
      sourceEnvironments,
      and(
        eq(sourceEnvironments.id, apps.sourceEnvironmentId),
        eq(sourceEnvironments.sourceId, apps.sourceId),
      ),
    )
    .where(and(eq(apps.id, slot.id), eq(apps.workspaceId, slot.workspaceId)))
    .limit(1);
  if (!instance)
    throw conflict(
      "This instance requires an environment mapping",
      "ENVIRONMENT_REQUIRED",
    );
  if (
    slot.environment !== instance.environment &&
    slot.environment !== `preview:${instance.environment}`
  ) {
    throw unprocessable(
      "Secret environment does not match this instance",
      "SECRET_ENVIRONMENT_MISMATCH",
    );
  }
  return requiredKeysForStage(instance.declarations, slot.stage);
}

export async function readSecretMetadata(
  slot: SecretSlot,
  database: SecretDatabase = getTowbarDatabase(),
) {
  const declaredKeys = await declaredKeysForSlot(slot, database);
  const [row] = await database
    .select({
      keys: managedSecrets.keys,
      revision: managedSecrets.revision,
      updatedAt: managedSecrets.updatedAt,
    })
    .from(managedSecrets)
    .where(secretSlotFilter(slot))
    .limit(1);
  const metadata = row ?? {
    keys: [] as string[],
    revision: null,
    updatedAt: null,
  };
  if (declaredKeys === null)
    return { ...metadata, missingKeys: [] as string[], declared: false };
  const current = await readSecretValues(slot, database);
  return {
    ...metadata,
    keys: [...declaredKeys].sort(),
    missingKeys: declaredKeys
      .filter((key) => !Object.hasOwn(current.values, key))
      .sort(),
    declared: true,
  };
}

export async function readSecretValues(
  slot: SecretSlot,
  database: SecretDatabase = getTowbarDatabase(),
) {
  await declaredKeysForSlot(slot, database);
  const [row] = await database
    .select()
    .from(managedSecrets)
    .where(secretSlotFilter(slot))
    .limit(1);
  if (!row) return { values: {} as Record<string, string>, revision: null };
  try {
    return {
      values: decryptCredential<Record<string, string>>({
        associatedData: `${slotKey(slot)}:${row.id}`,
        masterKey: parseCredentialsMasterKey(getEnv().TOWBAR_CREDENTIALS_KEY),
        envelope: row.encryptedPayload,
      }),
      revision: row.revision,
    };
  } catch {
    throw unprocessable(
      "Stored credentials could not be unlocked. Check the installation encryption key.",
      "SECRET_DECRYPTION_FAILED",
    );
  }
}

export async function mutateSecret(
  slot: SecretSlot,
  mutation: SecretMutation,
  actorUserId: string,
  validate?: (values: Record<string, string>) => void,
) {
  return await getTowbarDatabase().transaction(async (database) => {
    // Serialize the empty-slot case too; SELECT FOR UPDATE alone cannot lock a missing row.
    await database.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${slotKey(slot)}, 0))`,
    );
    const owner = await requireSecretOwner(slot, database);
    const [row] = await database
      .select()
      .from(managedSecrets)
      .where(secretSlotFilter(slot))
      .limit(1);
    if ((row?.revision ?? null) !== mutation.expectedRevision)
      throw conflict(
        "These secrets changed after loading. Refresh before saving.",
        "SECRET_VERSION_CHANGED",
      );
    const declaredKeys = await declaredKeysForSlot(slot, database);
    if (
      declaredKeys !== null &&
      (mutation.delete.length > 0 ||
        Object.keys(mutation.set).some((key) => !declaredKeys.includes(key)))
    ) {
      throw unprocessable(
        "Required secret keys are managed in YAML. Edit values here; sync YAML to add or remove keys.",
        "SECRET_DECLARATIONS_MANAGED",
      );
    }
    const current = await readSecretValues(slot, database);
    const values = applySecretMutation(current.values, mutation);
    if (
      ["build", "deployment", "pre_deploy", "post_deploy"].includes(slot.stage)
    )
      validateSecretObject(
        values,
        slot.stage === "build" ? "build" : "deployment",
      );
    if (Buffer.byteLength(JSON.stringify(values), "utf8") > 256 * 1024)
      throw unprocessable(
        "Secret values exceed the 256 KiB limit",
        "SECRET_TOO_LARGE",
      );
    if (
      slot.stage === "build" &&
      Object.hasOwn(values, "TOWBAR_BUILD_ENV_JSON")
    )
      throw unprocessable("TOWBAR_BUILD_ENV_JSON is reserved by Towbar");
    validate?.(values);
    const id = row?.id ?? randomUUID();
    const revision = randomUUID();
    const updatedAt = new Date();
    const record = {
      ...owner,
      id,
      workspaceId: slot.workspaceId,
      owner: ownerKey(slot),
      environment: slot.environment,
      stage: slot.stage,
      revision,
      updatedAt,
      keys:
        declaredKeys === null
          ? Object.keys(values).sort()
          : [...declaredKeys].sort(),
      encryptedPayload: encryptCredential({
        associatedData: `${slotKey(slot)}:${id}`,
        masterKey: parseCredentialsMasterKey(getEnv().TOWBAR_CREDENTIALS_KEY),
        value: values,
      }),
    };
    if (row)
      await database
        .update(managedSecrets)
        .set(record)
        .where(eq(managedSecrets.id, id));
    else await database.insert(managedSecrets).values(record);
    await database.insert(auditEvents).values({
      workspaceId: slot.workspaceId,
      actorUserId,
      action: "secrets.updated",
      targetType: slot.type,
      targetId: ownerKey(slot),
      metadata: {
        environment: slot.environment,
        stage: slot.stage,
        revision,
      },
    });
    return { keys: record.keys, revision, updatedAt };
  });
}

export async function resolveServerCredentials(
  input: { workspaceId: string; serverId: string },
  database: SecretDatabase = getTowbarDatabase(),
) {
  const result = await readSecretValues(
    {
      type: "server",
      id: input.serverId,
      workspaceId: input.workspaceId,
      environment: "production",
      stage: "credentials",
    },
    database,
  );
  if (!result.values.privateKey)
    throw unprocessable(
      "Configure the SSH private key in Server → Settings → Configuration",
      "SERVER_CREDENTIALS_MISSING",
    );
  return result;
}

export async function revealSecretValue(
  slot: SecretSlot,
  key: string,
  actorUserId: string,
) {
  await requireSecretOwner(slot);
  const { values, revision } = await readSecretValues(slot);
  if (!Object.hasOwn(values, key)) throw notFound("Secret");
  await getTowbarDatabase()
    .insert(auditEvents)
    .values({
      workspaceId: slot.workspaceId,
      actorUserId,
      action: "secrets.revealed",
      targetType: slot.type,
      targetId: ownerKey(slot),
      metadata: {
        environment: slot.environment,
        stage: slot.stage,
        key,
        revision,
      },
    });
  return { value: values[key]!, revision };
}

export async function revealSecretValues(
  slot: SecretSlot,
  actorUserId: string,
) {
  await requireSecretOwner(slot);
  const { values, revision } = await readSecretValues(slot);
  await getTowbarDatabase()
    .insert(auditEvents)
    .values({
      workspaceId: slot.workspaceId,
      actorUserId,
      action: "secrets.revealed",
      targetType: slot.type,
      targetId: ownerKey(slot),
      metadata: {
        environment: slot.environment,
        stage: slot.stage,
        keyCount: Object.keys(values).length,
        revision,
      },
    });
  return { values, revision };
}
