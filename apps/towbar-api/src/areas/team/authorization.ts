import { and, eq, isNull } from "drizzle-orm";
import { isWorkspaceRole } from "@workspace/towbar-access";
import {
  users,
  workspaceMembers,
  workspaces,
} from "@workspace/towbar-database/schema";
import { forbidden } from "../../http/errors.js";
import type { AuthDatabase } from "../../infrastructure/database.js";

export async function lockTeam(database: AuthDatabase, workspaceId: string) {
  const [workspace] = await database
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .for("update");
  if (!workspace) throw forbidden();
  return workspace;
}
export async function currentMembership(
  database: AuthDatabase,
  workspaceId: string,
  userId: string,
) {
  const [member] = await database
    .select({
      id: workspaceMembers.id,
      role: workspaceMembers.role,
      userId: users.id,
      mustChangePassword: users.mustChangePassword,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
        isNull(users.disabledAt),
      ),
    )
    .limit(1);
  if (!member || !isWorkspaceRole(member.role) || member.mustChangePassword)
    throw forbidden("Your team access has changed. Sign in again to continue");
  return member;
}
export async function requireTeamAdmin(
  database: AuthDatabase,
  workspaceId: string,
  userId: string,
) {
  const member = await currentMembership(database, workspaceId, userId);
  if (member.role !== "admin")
    throw forbidden("Only admins can manage this team");
  return member;
}
