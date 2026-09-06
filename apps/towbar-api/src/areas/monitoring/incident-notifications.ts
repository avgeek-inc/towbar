import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  notificationDeliveries,
  notificationDestinations,
  notificationEvents,
  scoutAlertIncidents,
} from "@workspace/towbar-database/schema";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { notFound } from "../../http/errors.js";
import { getServer } from "../servers/service.js";
import type { ScoutScope } from "./alert-rules.js";

export const incidentNotificationsQuery = z
  .object({
    before: z.iso.datetime({ offset: true }).optional(),
    beforeId: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(10),
  })
  .refine(
    (v) => Boolean(v.before) === Boolean(v.beforeId),
    "A cursor needs both before and beforeId",
  );
export async function listIncidentNotifications(
  input: ScoutScope & { incidentId: string } & z.infer<
      typeof incidentNotificationsQuery
    >,
) {
  const incidentId = z.uuid().parse(input.incidentId);
  await getServer(input.serverId, input.workspaceId);
  const db = getTowbarDatabase();
  const [incident] = await db
    .select({ id: scoutAlertIncidents.id })
    .from(scoutAlertIncidents)
    .where(
      and(
        eq(scoutAlertIncidents.id, incidentId),
        eq(scoutAlertIncidents.workspaceId, input.workspaceId),
        eq(scoutAlertIncidents.serverId, input.serverId),
      ),
    )
    .limit(1);
  if (!incident) throw notFound("Scout incident");
  const rows = await db
    .select({
      id: notificationDeliveries.id,
      state: notificationDeliveries.state,
      type: notificationEvents.type,
      provider: notificationDestinations.provider,
      config: notificationDestinations.config,
      createdAt: notificationDeliveries.createdAt,
      deliveredAt: notificationDeliveries.deliveredAt,
      attemptCount: notificationDeliveries.attemptCount,
      errorCode: notificationDeliveries.lastErrorCode,
    })
    .from(notificationDeliveries)
    .innerJoin(
      notificationEvents,
      and(
        eq(notificationEvents.id, notificationDeliveries.eventId),
        eq(notificationEvents.workspaceId, input.workspaceId),
        eq(notificationEvents.serverId, input.serverId),
      ),
    )
    .innerJoin(
      notificationDestinations,
      and(
        eq(notificationDestinations.id, notificationDeliveries.destinationId),
        eq(notificationDestinations.workspaceId, input.workspaceId),
        eq(notificationDestinations.serverId, input.serverId),
      ),
    )
    .where(
      and(
        eq(notificationEvents.category, "scout"),
        sql`${notificationEvents.payload}->'details'->>'incidentId'=${incidentId}`,
        input.before && input.beforeId
          ? or(
              lt(notificationDeliveries.createdAt, new Date(input.before)),
              and(
                eq(notificationDeliveries.createdAt, new Date(input.before)),
                lt(notificationDeliveries.id, input.beforeId),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(
      desc(notificationDeliveries.createdAt),
      desc(notificationDeliveries.id),
    )
    .limit(input.limit + 1);
  const items = rows.slice(0, input.limit).map(({ config, ...row }) => ({
    ...row,
    destination:
      "recipients" in config ? config.recipients.join(", ") : config.channelId,
  }));
  return {
    items,
    nextBefore:
      rows.length > input.limit ? items.at(-1)!.createdAt.toISOString() : null,
    nextBeforeId: rows.length > input.limit ? items.at(-1)!.id : null,
  };
}
