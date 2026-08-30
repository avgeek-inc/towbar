import { and, desc, eq, inArray, or } from "drizzle-orm";

import { apps, auditEvents, users } from "@workspace/towbar-database/schema";

import { getTowbarDatabase } from "../../infrastructure/database.js";

const controlActions = [
  "auto_deploy.control_updated",
  "auto_deploy.circuit_opened",
  "auto_deploy.circuit_recovered",
  "auto_deploy.manual_bypass",
] as const;

export async function getActor(userId: string) {
  const [actor] = await getTowbarDatabase()
    .select({ displayName: users.displayName, id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return actor ?? null;
}

export async function listSourceControlEvents(
  sourceId: string,
  workspaceId: string,
) {
  const deployables = await getTowbarDatabase()
    .select({ id: apps.id })
    .from(apps)
    .where(and(eq(apps.sourceId, sourceId), eq(apps.workspaceId, workspaceId)));
  return await listControlEvents({
    targetIds: [sourceId, ...deployables.map((deployable) => deployable.id)],
    workspaceId,
  });
}

export async function listTargetControlEvents(
  targetId: string,
  workspaceId: string,
) {
  return await listControlEvents({ targetIds: [targetId], workspaceId });
}

async function listControlEvents(input: {
  targetIds: string[];
  workspaceId: string;
}) {
  return await getTowbarDatabase()
    .select({
      action: auditEvents.action,
      actor: { displayName: users.displayName, id: users.id },
      createdAt: auditEvents.createdAt,
      id: auditEvents.id,
      metadata: auditEvents.metadata,
      targetId: auditEvents.targetId,
      targetType: auditEvents.targetType,
    })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.actorUserId))
    .where(
      and(
        eq(auditEvents.workspaceId, input.workspaceId),
        inArray(auditEvents.targetId, input.targetIds),
        or(...controlActions.map((action) => eq(auditEvents.action, action))),
      ),
    )
    .orderBy(desc(auditEvents.createdAt))
    .limit(10);
}
