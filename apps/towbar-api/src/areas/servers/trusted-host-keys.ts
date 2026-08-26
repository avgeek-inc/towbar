import { and, eq, isNull } from "drizzle-orm";

import { sshHostKeys } from "@workspace/towbar-database/schema";

import { badRequest, notFound } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { parseTrustedHostKey } from "./host-key.js";
import { getServer } from "./service.js";

export async function listTrustedHostKeys(
  serverId: string,
  workspaceId: string,
) {
  await getServer(serverId, workspaceId);
  return await getTowbarDatabase()
    .select({
      algorithm: sshHostKeys.algorithm,
      createdAt: sshHostKeys.createdAt,
      fingerprint: sshHostKeys.fingerprint,
      id: sshHostKeys.id,
    })
    .from(sshHostKeys)
    .where(
      and(eq(sshHostKeys.serverId, serverId), isNull(sshHostKeys.revokedAt)),
    );
}

export async function trustServerHostKey(input: {
  algorithm: string;
  fingerprint: string;
  publicKey: string;
  serverId: string;
  trustedBy: string;
  workspaceId: string;
}) {
  await getServer(input.serverId, input.workspaceId);
  let hostKey: ReturnType<typeof parseTrustedHostKey>;
  try {
    hostKey = parseTrustedHostKey(input);
  } catch (error) {
    throw badRequest(
      error instanceof Error ? error.message : "Host public key is invalid",
      "INVALID_HOST_KEY",
    );
  }
  const [key] = await getTowbarDatabase()
    .insert(sshHostKeys)
    .values({ ...input, ...hostKey })
    .onConflictDoUpdate({
      target: [sshHostKeys.serverId, sshHostKeys.fingerprint],
      set: { publicKey: hostKey.publicKey, revokedAt: null },
    })
    .returning({
      algorithm: sshHostKeys.algorithm,
      fingerprint: sshHostKeys.fingerprint,
      id: sshHostKeys.id,
    });
  return key;
}

export async function revokeServerHostKey(input: {
  hostKeyId: string;
  serverId: string;
  workspaceId: string;
}) {
  await getServer(input.serverId, input.workspaceId);
  const [key] = await getTowbarDatabase()
    .update(sshHostKeys)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(sshHostKeys.id, input.hostKeyId),
        eq(sshHostKeys.serverId, input.serverId),
        isNull(sshHostKeys.revokedAt),
      ),
    )
    .returning({ id: sshHostKeys.id });
  if (!key) throw notFound("Trusted host key");
  return key;
}
