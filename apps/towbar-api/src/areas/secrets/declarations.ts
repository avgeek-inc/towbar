import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  encryptCredential,
  parseCredentialsMasterKey,
  reconcileDeclaredSecretValues,
  requiredSecretStages,
} from "@workspace/towbar-core";
import { managedSecrets } from "@workspace/towbar-database/schema";
import { getEnv } from "../../env.js";
import {
  ownerKey,
  readSecretValues,
  requireSecretOwner,
  secretSlotFilter,
  slotKey,
} from "./store.js";
import type { RequiredSecrets } from "@workspace/towbar-core";
import type { SecretDatabase, SecretSlot } from "./store.js";

export async function reconcileInstanceSecretDeclarations(
  input: {
    appId: string;
    workspaceId: string;
    environment: string;
    declarations: RequiredSecrets;
  },
  database: SecretDatabase,
) {
  for (const [declaration, stage] of Object.entries(requiredSecretStages)) {
    const slot: SecretSlot = {
      type: "app",
      id: input.appId,
      workspaceId: input.workspaceId,
      environment: input.environment,
      stage,
    };
    await database.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${slotKey(slot)}, 0))`,
    );
    const owner = await requireSecretOwner(slot, database);
    const [row] = await database
      .select()
      .from(managedSecrets)
      .where(secretSlotFilter(slot));
    const current = await readSecretValues(slot, database);
    const required = input.declarations[declaration as keyof RequiredSecrets];
    const reconciled = reconcileDeclaredSecretValues(required, current.values);
    if (
      row &&
      reconciled.removedKeys.length === 0 &&
      JSON.stringify(row.keys) === JSON.stringify(reconciled.keys)
    )
      continue;
    if (!row && required.length === 0) continue;
    const id = row?.id ?? randomUUID();
    const values = {
      ...owner,
      id,
      workspaceId: input.workspaceId,
      owner: ownerKey(slot),
      environment: slot.environment,
      stage,
      keys: reconciled.keys,
      revision: randomUUID(),
      updatedAt: new Date(),
      encryptedPayload: encryptCredential({
        associatedData: `${slotKey(slot)}:${id}`,
        masterKey: parseCredentialsMasterKey(getEnv().TOWBAR_CREDENTIALS_KEY),
        value: reconciled.values,
      }),
    };
    if (row)
      await database
        .update(managedSecrets)
        .set(values)
        .where(eq(managedSecrets.id, id));
    else await database.insert(managedSecrets).values(values);
  }
}
