import { randomUUID } from "node:crypto";
import { HttpError, badRequest, notFound } from "../../http/errors.js";
import { getRuntimeNotificationProvider } from "../../infrastructure/runtime-notifications.js";
import { listTelegramDestinations } from "./telegram-destinations.js";
import { NotificationProviderError, deliverNotification } from "./providers.js";

const defaultDependencies = {
  getProvider: () => getRuntimeNotificationProvider("telegram"),
  listDestinations: listTelegramDestinations,
  deliver: deliverNotification,
};

export async function sendTestTelegramDestination(
  workspaceId: string,
  chatId: string,
  messageThreadId: number | null,
  dependencies: {
    getProvider: typeof defaultDependencies.getProvider;
    listDestinations: (
      workspaceId: string,
    ) => Promise<
      Array<{ id: string; chatId: string; messageThreadId: number | null }>
    >;
    deliver: (
      input: Parameters<typeof deliverNotification>[0],
    ) => Promise<unknown>;
  } = defaultDependencies,
) {
  const providerConfiguration = dependencies.getProvider();
  if (!providerConfiguration)
    throw badRequest(
      "Configure a Telegram bot token in the runtime before testing destinations",
      "TELEGRAM_NOT_CONFIGURED",
    );
  const destination = (await dependencies.listDestinations(workspaceId)).find(
    (row) => row.chatId === chatId && row.messageThreadId === messageThreadId,
  );
  if (!destination) throw notFound("Telegram destination");
  try {
    await dependencies.deliver({
      config: {
        chatId: destination.chatId,
        ...(destination.messageThreadId
          ? { messageThreadId: destination.messageThreadId }
          : {}),
      },
      eventId: randomUUID(),
      eventType: "notification.test",
      payload: {
        details: {},
        entity: {
          id: destination.id,
          kind: "notification",
          name: destination.chatId,
        },
        message: "This is a sample notification from Towbar.",
        occurredAt: new Date().toISOString(),
        source: null,
        title: "Test notification",
      },
      provider: "telegram",
      providerConfiguration,
    });
  } catch (error) {
    if (error instanceof NotificationProviderError)
      throw new HttpError(502, error.code, error.message, { cause: error });
    throw error;
  }
  return { status: "accepted" as const };
}
