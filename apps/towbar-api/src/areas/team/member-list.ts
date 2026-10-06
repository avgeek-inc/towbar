import { count, eq } from "drizzle-orm";
import { users, workspaceMembers } from "@workspace/towbar-database/schema";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import type { AuthenticatedUser } from "../../http/types.js";
import { passkeyEnabled } from "../auth/passkeys.js";
import { requireTeamAdmin } from "./authorization.js";

export async function listTeamMembers(
  user: AuthenticatedUser,
  input: { offset: number; limit: number },
) {
  await requireTeamAdmin(getTowbarDatabase(), user.workspaceId, user.id);
  const where = eq(workspaceMembers.workspaceId, user.workspaceId);
  const [total] = await getTowbarDatabase()
    .select({ value: count() })
    .from(workspaceMembers)
    .where(where);
  const members = await getTowbarDatabase()
    .select({
      id: workspaceMembers.id,
      userId: users.id,
      name: users.displayName,
      email: users.email,
      role: workspaceMembers.role,
      emailVerified: users.emailVerified,
      mustChangePassword: users.mustChangePassword,
      twoFactorEnabled: passkeyEnabled,
      createdAt: workspaceMembers.createdAt,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(workspaceMembers.userId, users.id))
    .where(where)
    .orderBy(users.displayName, workspaceMembers.id)
    .offset(input.offset)
    .limit(input.limit);
  return { members, total: total?.value ?? 0 };
}
