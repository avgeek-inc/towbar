import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { notificationWebhookRouteSettings } from "@workspace/towbar-database/schema";
import { badRequest } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { getRuntimeNotifications } from "../../infrastructure/runtime-notifications.js";

export const webhookDestinationsSchema = z
  .object({
    destinations: z
      .array(
        z
          .object({
            routeId: z.string().min(1).max(255),
            label: z.string().trim().min(1).max(100),
            hostname: z.string().min(1).max(255),
            deployments: z.boolean(),
            backupsAndRestores: z.boolean(),
            alertsAndIncidents: z.boolean(),
          })
          .strict(),
      )
      .max(100)
      .refine(
        (rows) => new Set(rows.map((row) => row.routeId)).size === rows.length,
        "Each Webhook route can appear only once",
      ),
  })
  .strict();

type WebhookDestinationInput = z.infer<
  typeof webhookDestinationsSchema
>["destinations"][number];
type WebhookDestinationSetting = Pick<
  WebhookDestinationInput,
  "deployments" | "backupsAndRestores" | "alertsAndIncidents"
>;

function configuredWebhookRoutes() {
  return getRuntimeNotifications().routes.filter(
    (
      route,
    ): route is Extract<
      ReturnType<typeof getRuntimeNotifications>["routes"][number],
      { provider: "webhook" }
    > => route.provider === "webhook",
  );
}

async function settingsByRoute(workspaceId: string) {
  const settings = await getTowbarDatabase()
    .select()
    .from(notificationWebhookRouteSettings)
    .where(eq(notificationWebhookRouteSettings.workspaceId, workspaceId));
  return new Map(settings.map((row) => [row.routeId, row]));
}

function destinationFromRoute(
  route: ReturnType<typeof configuredWebhookRoutes>[number],
  setting?: WebhookDestinationSetting,
): WebhookDestinationInput {
  return {
    routeId: route.id,
    label: route.config.label ?? route.id,
    hostname: new URL(route.config.url).hostname,
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
  route: ReturnType<typeof configuredWebhookRoutes>[number],
  setting?: WebhookDestinationSetting,
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

export async function listWebhookDestinations(workspaceId: string) {
  const settings = await settingsByRoute(workspaceId);
  return configuredWebhookRoutes().map((route) =>
    destinationFromRoute(route, settings.get(route.id)),
  );
}

export async function saveWebhookDestinations(
  workspaceId: string,
  destinations: WebhookDestinationInput[],
) {
  const routes = configuredWebhookRoutes();
  if (!routes.length)
    throw badRequest(
      "Configure a webhook endpoint in the runtime before managing destinations",
      "WEBHOOK_NOT_CONFIGURED",
    );
  if (
    destinations.some((row) => {
      const route = routes.find((item) => item.id === row.routeId);
      return (
        !route ||
        (route.config.label ?? route.id) !== row.label ||
        new URL(route.config.url).hostname !== row.hostname
      );
    })
  )
    throw badRequest("A Webhook route is no longer configured in the runtime");
  await getTowbarDatabase().transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(notificationWebhookRouteSettings)
      .where(eq(notificationWebhookRouteSettings.workspaceId, workspaceId));
    const byRoute = new Map(existing.map((row) => [row.routeId, row]));
    for (const row of destinations) {
      const values = {
        deployments: row.deployments,
        backupsAndRestores: row.backupsAndRestores,
        alertsAndIncidents: row.alertsAndIncidents,
      };
      if (byRoute.has(row.routeId))
        await tx
          .update(notificationWebhookRouteSettings)
          .set(values)
          .where(
            and(
              eq(notificationWebhookRouteSettings.workspaceId, workspaceId),
              eq(notificationWebhookRouteSettings.routeId, row.routeId),
            ),
          );
      else
        await tx
          .insert(notificationWebhookRouteSettings)
          .values({ ...values, routeId: row.routeId, workspaceId });
    }
  });
  return listWebhookDestinations(workspaceId);
}

export async function webhookNotificationRoutes(workspaceId: string) {
  const settings = await settingsByRoute(workspaceId);
  return configuredWebhookRoutes().map((route) =>
    routeWithSetting(route, settings.get(route.id)),
  );
}

export async function webhookNotificationRoute(
  workspaceId: string,
  destinationId: string,
) {
  const route = configuredWebhookRoutes().find(
    (item) => item.id === destinationId,
  );
  if (!route) return null;
  const setting = (await settingsByRoute(workspaceId)).get(destinationId);
  return routeWithSetting(route, setting);
}
