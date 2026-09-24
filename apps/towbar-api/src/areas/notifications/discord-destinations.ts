import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { discordWebhookCredentialsSchema } from "@workspace/towbar-core";
import { notificationDiscordRouteSettings } from "@workspace/towbar-database/schema";
import { badRequest } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { getRuntimeNotifications } from "../../infrastructure/runtime-notifications.js";

export const discordDestinationsSchema = z
  .object({
    destinations: z
      .array(
        z
          .object({
            routeId: z.string().min(1).max(255),
            webhookId: discordWebhookCredentialsSchema.shape.webhookId,
            deployments: z.boolean(),
            backupsAndRestores: z.boolean(),
            alertsAndIncidents: z.boolean(),
          })
          .strict(),
      )
      .max(100)
      .refine(
        (rows) => new Set(rows.map((row) => row.routeId)).size === rows.length,
        "Each Discord route can appear only once",
      ),
  })
  .strict();

type DiscordDestinationInput = z.infer<
  typeof discordDestinationsSchema
>["destinations"][number];
type DiscordDestinationSetting = Pick<
  DiscordDestinationInput,
  "deployments" | "backupsAndRestores" | "alertsAndIncidents"
>;

function configuredDiscordRoutes() {
  return getRuntimeNotifications().routes.filter(
    (
      route,
    ): route is Extract<
      ReturnType<typeof getRuntimeNotifications>["routes"][number],
      { provider: "discord" }
    > => route.provider === "discord",
  );
}

async function settingsByRoute(workspaceId: string) {
  const settings = await getTowbarDatabase()
    .select()
    .from(notificationDiscordRouteSettings)
    .where(eq(notificationDiscordRouteSettings.workspaceId, workspaceId));
  return new Map(settings.map((row) => [row.routeId, row]));
}

function destinationFromRoute(
  route: ReturnType<typeof configuredDiscordRoutes>[number],
  setting?: DiscordDestinationSetting,
): DiscordDestinationInput {
  return {
    routeId: route.id,
    webhookId: route.config.webhookId,
    deployments:
      setting?.deployments ?? route.categories.includes("deployments"),
    backupsAndRestores:
      setting?.backupsAndRestores ??
      (route.categories.includes("backups") ||
        route.categories.includes("restores")),
    alertsAndIncidents:
      setting?.alertsAndIncidents ??
      (route.categories.includes("health") ||
        route.categories.includes("scout")),
  };
}

function routeWithSetting(
  route: ReturnType<typeof configuredDiscordRoutes>[number],
  setting?: DiscordDestinationSetting,
) {
  if (!setting) return route;
  return {
    ...route,
    categories: [
      ...(setting.deployments ? ["deployments" as const] : []),
      ...(setting.backupsAndRestores
        ? ["backups" as const, "restores" as const]
        : []),
      ...(setting.alertsAndIncidents
        ? ["health" as const, "scout" as const]
        : []),
    ],
  };
}

export async function listDiscordDestinations(workspaceId: string) {
  const settings = await settingsByRoute(workspaceId);
  return configuredDiscordRoutes().map((route) =>
    destinationFromRoute(route, settings.get(route.id)),
  );
}

export async function saveDiscordDestinations(
  workspaceId: string,
  destinations: DiscordDestinationInput[],
) {
  const routes = configuredDiscordRoutes();
  if (!routes.length)
    throw badRequest(
      "Configure a Discord webhook route in the runtime before managing destinations",
      "DISCORD_NOT_CONFIGURED",
    );
  const routeIds = new Set(routes.map((route) => route.id));
  if (
    destinations.some(
      (row) =>
        !routeIds.has(row.routeId) ||
        routes.find((route) => route.id === row.routeId)?.config.webhookId !==
          row.webhookId,
    )
  )
    throw badRequest("A Discord route is no longer configured in the runtime");
  await getTowbarDatabase().transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(notificationDiscordRouteSettings)
      .where(eq(notificationDiscordRouteSettings.workspaceId, workspaceId));
    const byRoute = new Map(existing.map((row) => [row.routeId, row]));
    for (const row of destinations) {
      const values = {
        deployments: row.deployments,
        backupsAndRestores: row.backupsAndRestores,
        alertsAndIncidents: row.alertsAndIncidents,
      };
      if (byRoute.has(row.routeId))
        await tx
          .update(notificationDiscordRouteSettings)
          .set(values)
          .where(
            and(
              eq(notificationDiscordRouteSettings.workspaceId, workspaceId),
              eq(notificationDiscordRouteSettings.routeId, row.routeId),
            ),
          );
      else
        await tx
          .insert(notificationDiscordRouteSettings)
          .values({ ...values, routeId: row.routeId, workspaceId });
    }
  });
  return listDiscordDestinations(workspaceId);
}

export async function discordNotificationRoutes(workspaceId: string) {
  const settings = await settingsByRoute(workspaceId);
  return configuredDiscordRoutes().map((route) =>
    routeWithSetting(route, settings.get(route.id)),
  );
}

export async function discordNotificationRoute(
  workspaceId: string,
  destinationId: string,
) {
  const route = configuredDiscordRoutes().find(
    (item) => item.id === destinationId,
  );
  if (!route) return null;
  const setting = (await settingsByRoute(workspaceId)).get(destinationId);
  return routeWithSetting(route, setting);
}
