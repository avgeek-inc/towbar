import { createHash } from "node:crypto";
import { and, eq, notInArray } from "drizzle-orm";
import { z } from "zod";
import { slackNotificationConfigSchema } from "@workspace/towbar-core";
import {
  notificationSlackDestinations,
  notificationSlackRouting,
} from "@workspace/towbar-database/schema";
import { badRequest } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { getRuntimeNotifications } from "../../infrastructure/runtime-notifications.js";

export const slackDestinationsSchema = z
  .object({
    destinations: z
      .array(
        z
          .object({
            channelId: slackNotificationConfigSchema.shape.channelId,
            deployments: z.boolean(),
            backupsAndRestores: z.boolean(),
            scout: z.boolean(),
          })
          .strict(),
      )
      .max(100)
      .refine(
        (rows) =>
          new Set(rows.map((row) => row.channelId)).size === rows.length,
        "Each Slack channel can appear only once",
      ),
  })
  .strict();

type SlackDestinationInput = z.infer<
  typeof slackDestinationsSchema
>["destinations"][number];

function legacySlackDestinations(): SlackDestinationInput[] {
  const byChannel = new Map<string, SlackDestinationInput>();
  for (const route of getRuntimeNotifications().routes) {
    if (route.provider !== "slack") continue;
    const channelId = route.config.channelId;
    const row = byChannel.get(channelId) ?? {
      channelId,
      deployments: false,
      backupsAndRestores: false,
      scout: false,
    };
    row.deployments ||= route.categories.includes("deployments");
    row.backupsAndRestores ||=
      route.categories.includes("backups") ||
      route.categories.includes("restores");
    row.scout ||=
      route.categories.includes("health") || route.categories.includes("scout");
    byChannel.set(channelId, row);
  }
  return [...byChannel.values()].sort((a, b) =>
    a.channelId.localeCompare(b.channelId),
  );
}

export async function slackRoutingMigrated(workspaceId: string) {
  const [row] = await getTowbarDatabase()
    .select({ workspaceId: notificationSlackRouting.workspaceId })
    .from(notificationSlackRouting)
    .where(eq(notificationSlackRouting.workspaceId, workspaceId))
    .limit(1);
  return Boolean(row);
}

export async function listSlackDestinations(workspaceId: string) {
  if (!(await slackRoutingMigrated(workspaceId))) {
    return legacySlackDestinations().map((row) => ({
      ...row,
      id: `legacy-${createHash("sha256").update(row.channelId).digest("hex").slice(0, 16)}`,
    }));
  }
  const rows = await getTowbarDatabase()
    .select()
    .from(notificationSlackDestinations)
    .where(eq(notificationSlackDestinations.workspaceId, workspaceId));
  return rows.map(({ legacyRouteIds: _legacyRouteIds, health, ...row }) => ({
    ...row,
    scout: row.scout || health,
  }));
}

export async function saveSlackDestinations(
  workspaceId: string,
  destinations: SlackDestinationInput[],
) {
  if (!getRuntimeNotifications().providers.slack)
    throw badRequest(
      "Configure Slack bot credentials in the runtime before adding channels",
      "SLACK_NOT_CONFIGURED",
    );
  await getTowbarDatabase().transaction(async (tx) => {
    await tx
      .insert(notificationSlackRouting)
      .values({ workspaceId })
      .onConflictDoNothing();
    const existing = await tx
      .select()
      .from(notificationSlackDestinations)
      .where(eq(notificationSlackDestinations.workspaceId, workspaceId));
    const byChannel = new Map(existing.map((row) => [row.channelId, row]));
    const legacyIds = new Map<string, string[]>();
    for (const route of getRuntimeNotifications().routes) {
      if (route.provider !== "slack") continue;
      const ids = legacyIds.get(route.config.channelId) ?? [];
      ids.push(route.id);
      legacyIds.set(route.config.channelId, ids);
    }
    for (const row of destinations) {
      const current = byChannel.get(row.channelId);
      if (current)
        await tx
          .update(notificationSlackDestinations)
          .set({ ...row, health: row.scout })
          .where(eq(notificationSlackDestinations.id, current.id));
      else
        await tx.insert(notificationSlackDestinations).values({
          ...row,
          health: row.scout,
          workspaceId,
          legacyRouteIds: legacyIds.get(row.channelId) ?? [],
        });
    }
    await tx.delete(notificationSlackDestinations).where(
      and(
        eq(notificationSlackDestinations.workspaceId, workspaceId),
        destinations.length
          ? notInArray(
              notificationSlackDestinations.channelId,
              destinations.map((row) => row.channelId),
            )
          : undefined,
      ),
    );
  });
  return listSlackDestinations(workspaceId);
}

function routeForRow(
  row: SlackDestinationInput & { id: string; health?: boolean },
) {
  return {
    id: `slack-${row.id}`,
    provider: "slack" as const,
    enabled: true,
    categories: [
      ...(row.deployments ? ["deployments" as const] : []),
      ...(row.backupsAndRestores
        ? ["backups" as const, "restores" as const]
        : []),
      ...(row.scout || row.health ? ["health" as const, "scout" as const] : []),
    ],
    config: { channelId: row.channelId },
  };
}

export async function slackNotificationRoutes(workspaceId: string) {
  if (!getRuntimeNotifications().providers.slack) return [];
  if (!(await slackRoutingMigrated(workspaceId)))
    return getRuntimeNotifications().routes.filter(
      (route) => route.provider === "slack",
    );
  return (await listSlackDestinations(workspaceId)).map(routeForRow);
}

export async function slackNotificationRoute(
  workspaceId: string,
  destinationId: string,
) {
  if (!destinationId.startsWith("slack-")) return null;
  const id = destinationId.slice(6);
  if (!z.string().uuid().safeParse(id).success) return null;
  const [row] = await getTowbarDatabase()
    .select()
    .from(notificationSlackDestinations)
    .where(
      and(
        eq(notificationSlackDestinations.id, id),
        eq(notificationSlackDestinations.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return row ? routeForRow(row) : null;
}

export async function legacySlackNotificationRoute(
  workspaceId: string,
  destinationId: string,
) {
  if (!(await slackRoutingMigrated(workspaceId))) return null;
  const rows = await getTowbarDatabase()
    .select()
    .from(notificationSlackDestinations)
    .where(eq(notificationSlackDestinations.workspaceId, workspaceId));
  const row = rows.find((destination) =>
    destination.legacyRouteIds.includes(destinationId),
  );
  if (!row) return null;
  return { ...routeForRow(row), id: destinationId };
}
