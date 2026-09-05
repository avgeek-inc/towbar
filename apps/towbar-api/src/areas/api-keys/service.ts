import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import {
  apiKeys,
  auditEvents,
  users,
  workspaceMembers,
} from "@workspace/towbar-database/schema";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { forbidden, notFound } from "../../http/errors.js";
import type { AuthenticatedUser } from "../../http/types.js";

const publicColumns = {
  id: apiKeys.id,
  name: apiKeys.name,
  purpose: apiKeys.purpose,
  access: apiKeys.access,
  prefix: apiKeys.tokenPrefix,
  expiresAt: apiKeys.expiresAt,
  revokedAt: apiKeys.revokedAt,
  lastUsedAt: apiKeys.lastUsedAt,
  createdAt: apiKeys.createdAt,
};
export function hashApiKey(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
export async function listApiKeys(user: AuthenticatedUser) {
  return getTowbarDatabase()
    .select(publicColumns)
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.userId, user.id),
        eq(apiKeys.workspaceId, user.workspaceId),
      ),
    )
    .orderBy(desc(apiKeys.createdAt));
}
export async function createApiKey(
  user: AuthenticatedUser,
  input: {
    name: string;
    purpose: "api" | "mcp" | "both";
    access: "read" | "write";
    expiresAt?: string | null;
  },
) {
  const token = `twb_${randomBytes(32).toString("base64url")}`;
  return getTowbarDatabase().transaction(async (database) => {
    const [key] = await database
      .insert(apiKeys)
      .values({
        ...input,
        userId: user.id,
        workspaceId: user.workspaceId,
        tokenHash: hashApiKey(token),
        tokenPrefix: token.slice(0, 12),
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      })
      .returning(publicColumns);
    if (!key) throw new Error("API key was not created");
    await database.insert(auditEvents).values({
      workspaceId: user.workspaceId,
      actorUserId: user.id,
      action: "api-key.created",
      targetType: "api-key",
      targetId: key.id,
      metadata: {
        purpose: input.purpose,
        access: input.access,
        expiresAt: input.expiresAt ?? null,
      },
    });
    return { key, token };
  });
}
export async function revokeApiKey(user: AuthenticatedUser, id: string) {
  await getTowbarDatabase().transaction(async (database) => {
    const [key] = await database
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(apiKeys.id, id),
          eq(apiKeys.userId, user.id),
          eq(apiKeys.workspaceId, user.workspaceId),
        ),
      )
      .returning({ id: apiKeys.id });
    if (!key) throw notFound("API key was not found");
    await database.insert(auditEvents).values({
      workspaceId: user.workspaceId,
      actorUserId: user.id,
      action: "api-key.revoked",
      targetType: "api-key",
      targetId: id,
    });
  });
}
export async function findApiKey(token: string, purpose: "api" | "mcp") {
  if (!/^twb_[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [identity] = await getTowbarDatabase()
    .select({
      id: apiKeys.id,
      access: apiKeys.access,
      purpose: apiKeys.purpose,
      userId: users.id,
      email: users.email,
      name: users.displayName,
      workspaceId: apiKeys.workspaceId,
      workspaceRole: workspaceMembers.role,
    })
    .from(apiKeys)
    .innerJoin(users, eq(apiKeys.userId, users.id))
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.userId, users.id),
        eq(workspaceMembers.workspaceId, apiKeys.workspaceId),
      ),
    )
    .where(
      and(
        eq(apiKeys.tokenHash, hashApiKey(token)),
        isNull(apiKeys.revokedAt),
        isNull(users.disabledAt),
        or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, new Date())),
      ),
    )
    .limit(1);
  if (!identity) return null;
  if (identity.purpose !== purpose && identity.purpose !== "both")
    throw forbidden(`This key is not enabled for ${purpose.toUpperCase()}`);
  await getTowbarDatabase()
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, identity.id));
  return {
    key: {
      id: identity.id,
      access: identity.access,
      purpose: identity.purpose,
    },
    user: {
      id: identity.userId,
      email: identity.email,
      name: identity.name,
      workspaceId: identity.workspaceId,
      workspaceRole: identity.workspaceRole,
    },
  };
}
