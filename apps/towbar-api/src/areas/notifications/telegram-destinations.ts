import { createHash } from "node:crypto";
import { and, eq, notInArray } from "drizzle-orm";
import { z } from "zod";
import { telegramNotificationConfigSchema } from "@workspace/towbar-core";
import {
  notificationTelegramDestinations,
  notificationTelegramRouting,
} from "@workspace/towbar-database/schema";
import { badRequest } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { getRuntimeNotifications } from "../../infrastructure/runtime-notifications.js";

const destinationSchema = z
  .object({
    chatId: telegramNotificationConfigSchema.shape.chatId.unwrap(),
    messageThreadId: telegramNotificationConfigSchema.shape.messageThreadId
      .unwrap()
      .nullable(),
    deployments: z.boolean(),
    backupsAndRestores: z.boolean(),
    alertsAndIncidents: z.boolean(),
  })
  .strict();

export const telegramDestinationsSchema = z
  .object({
    destinations: z
      .array(destinationSchema)
      .max(100)
      .refine(
        (rows) =>
          new Set(
            rows.map((row) => destinationKey(row.chatId, row.messageThreadId)),
          ).size === rows.length,
        "Each Telegram chat and topic can appear only once",
      ),
  })
  .strict();

type TelegramDestinationInput = z.infer<typeof destinationSchema>;

function destinationKey(
  chatId: string,
  messageThreadId: number | null | undefined,
) {
  return `${chatId}:${messageThreadId ?? 0}`;
}

function legacyChatId(runtime: ReturnType<typeof getRuntimeNotifications>) {
  const provider = runtime.providers.telegram;
  return provider?.provider === "telegram" ? provider.chatId : undefined;
}

function legacyTelegramDestinations(): Array<
  TelegramDestinationInput & { id: string }
> {
  const runtime = getRuntimeNotifications();
  const byDestination = new Map<string, TelegramDestinationInput>();
  for (const route of runtime.routes) {
    if (route.provider !== "telegram") continue;
    const chatId = route.config.chatId ?? legacyChatId(runtime);
    if (!chatId) continue;
    const messageThreadId = route.config.messageThreadId ?? null;
    const key = destinationKey(chatId, messageThreadId);
    const row = byDestination.get(key) ?? {
      chatId,
      messageThreadId,
      deployments: false,
      backupsAndRestores: false,
      alertsAndIncidents: false,
    };
    row.deployments ||= route.categories.includes("deployments");
    row.backupsAndRestores ||=
      route.categories.includes("backups") ||
      route.categories.includes("restores");
    row.alertsAndIncidents ||=
      route.categories.includes("health") || route.categories.includes("scout");
    byDestination.set(key, row);
  }
  return [...byDestination.entries()]
    .map(([key, row]) => ({
      ...row,
      id: `legacy-${createHash("sha256").update(key).digest("hex").slice(0, 16)}`,
    }))
    .sort(compareDestinations);
}

function compareDestinations(
  left: Pick<TelegramDestinationInput, "chatId" | "messageThreadId">,
  right: Pick<TelegramDestinationInput, "chatId" | "messageThreadId">,
) {
  return (
    left.chatId.localeCompare(right.chatId) ||
    (left.messageThreadId ?? 0) - (right.messageThreadId ?? 0)
  );
}

export async function telegramRoutingMigrated(workspaceId: string) {
  const [row] = await getTowbarDatabase()
    .select({ workspaceId: notificationTelegramRouting.workspaceId })
    .from(notificationTelegramRouting)
    .where(eq(notificationTelegramRouting.workspaceId, workspaceId))
    .limit(1);
  return Boolean(row);
}

export async function listTelegramDestinations(workspaceId: string) {
  if (!(await telegramRoutingMigrated(workspaceId)))
    return legacyTelegramDestinations();
  const rows = await getTowbarDatabase()
    .select()
    .from(notificationTelegramDestinations)
    .where(eq(notificationTelegramDestinations.workspaceId, workspaceId));
  return rows
    .map(({ legacyRouteIds: _legacyRouteIds, messageThreadId, ...row }) => ({
      ...row,
      messageThreadId: messageThreadId || null,
    }))
    .sort(compareDestinations);
}

export async function saveTelegramDestinations(
  workspaceId: string,
  destinations: TelegramDestinationInput[],
) {
  if (!getRuntimeNotifications().providers.telegram)
    throw badRequest(
      "Configure a Telegram bot token in the runtime before adding destinations",
      "TELEGRAM_NOT_CONFIGURED",
    );
  await getTowbarDatabase().transaction(async (tx) => {
    await tx
      .insert(notificationTelegramRouting)
      .values({ workspaceId })
      .onConflictDoNothing();
    const existing = await tx
      .select()
      .from(notificationTelegramDestinations)
      .where(eq(notificationTelegramDestinations.workspaceId, workspaceId));
    const byKey = new Map(
      existing.map((row) => [
        destinationKey(row.chatId, row.messageThreadId),
        row,
      ]),
    );
    const legacyIds = new Map<string, string[]>();
    const runtime = getRuntimeNotifications();
    for (const route of runtime.routes) {
      if (route.provider !== "telegram") continue;
      const chatId = route.config.chatId ?? legacyChatId(runtime);
      if (!chatId) continue;
      const key = destinationKey(chatId, route.config.messageThreadId);
      legacyIds.set(key, [...(legacyIds.get(key) ?? []), route.id]);
    }
    const keepIds = destinations
      .map(
        (row) => byKey.get(destinationKey(row.chatId, row.messageThreadId))?.id,
      )
      .filter((id): id is string => Boolean(id));
    await tx
      .delete(notificationTelegramDestinations)
      .where(
        and(
          eq(notificationTelegramDestinations.workspaceId, workspaceId),
          keepIds.length
            ? notInArray(notificationTelegramDestinations.id, keepIds)
            : undefined,
        ),
      );
    for (const row of destinations) {
      const key = destinationKey(row.chatId, row.messageThreadId);
      const current = byKey.get(key);
      const values = { ...row, messageThreadId: row.messageThreadId ?? 0 };
      if (current) {
        await tx
          .update(notificationTelegramDestinations)
          .set(values)
          .where(eq(notificationTelegramDestinations.id, current.id));
      } else {
        await tx.insert(notificationTelegramDestinations).values({
          ...values,
          workspaceId,
          legacyRouteIds: legacyIds.get(key) ?? [],
        });
      }
    }
  });
  return listTelegramDestinations(workspaceId);
}

function routeForRow(row: TelegramDestinationInput & { id: string }) {
  return {
    id: `telegram-${row.id}`,
    provider: "telegram" as const,
    enabled: true,
    categories: [
      ...(row.deployments ? ["deployments" as const] : []),
      ...(row.backupsAndRestores
        ? ["backups" as const, "restores" as const]
        : []),
      ...(row.alertsAndIncidents ? ["health" as const, "scout" as const] : []),
    ],
    config: {
      chatId: row.chatId,
      ...(row.messageThreadId ? { messageThreadId: row.messageThreadId } : {}),
    },
  };
}

export async function telegramNotificationRoutes(workspaceId: string) {
  if (!getRuntimeNotifications().providers.telegram) return [];
  if (!(await telegramRoutingMigrated(workspaceId)))
    return getRuntimeNotifications().routes.filter(
      (route) => route.provider === "telegram",
    );
  return (await listTelegramDestinations(workspaceId)).map(routeForRow);
}

export async function telegramNotificationRoute(
  workspaceId: string,
  destinationId: string,
) {
  if (!destinationId.startsWith("telegram-")) return null;
  const id = destinationId.slice(9);
  if (!z.string().uuid().safeParse(id).success) return null;
  const [row] = await getTowbarDatabase()
    .select()
    .from(notificationTelegramDestinations)
    .where(
      and(
        eq(notificationTelegramDestinations.id, id),
        eq(notificationTelegramDestinations.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return row ? routeForRow(row) : null;
}

export async function legacyTelegramNotificationRoute(
  workspaceId: string,
  destinationId: string,
) {
  if (!(await telegramRoutingMigrated(workspaceId))) return null;
  const rows = await getTowbarDatabase()
    .select()
    .from(notificationTelegramDestinations)
    .where(eq(notificationTelegramDestinations.workspaceId, workspaceId));
  const row = rows.find((destination) =>
    destination.legacyRouteIds.includes(destinationId),
  );
  return row ? { ...routeForRow(row), id: destinationId } : null;
}
