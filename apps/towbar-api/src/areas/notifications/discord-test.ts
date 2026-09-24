import { randomUUID } from "node:crypto";

import { HttpError, badRequest, notFound } from "../../http/errors.js";
import {
  getRuntimeNotificationProvider,
  getRuntimeNotificationRoute,
} from "../../infrastructure/runtime-notifications.js";
import { NotificationProviderError, deliverNotification } from "./providers.js";

const defaultDependencies = {
  getProvider: () => getRuntimeNotificationProvider("discord"),
  getRoute: getRuntimeNotificationRoute,
  deliver: deliverNotification,
};

export async function sendTestDiscordDestination(
  routeId: string,
  dependencies: {
    getProvider: typeof defaultDependencies.getProvider;
    getRoute: typeof defaultDependencies.getRoute;
    deliver: (
      input: Parameters<typeof deliverNotification>[0],
    ) => Promise<unknown>;
  } = defaultDependencies,
) {
  const providerConfiguration = dependencies.getProvider();
  if (!providerConfiguration)
    throw badRequest(
      "Configure a Discord webhook route in the runtime before testing it",
      "DISCORD_NOT_CONFIGURED",
    );
  const route = dependencies.getRoute(routeId);
  if (!route || route.provider !== "discord")
    throw notFound("Discord destination");

  try {
    await dependencies.deliver({
      config: route.config,
      eventId: randomUUID(),
      eventType: "notification.test",
      payload: {
        details: {},
        entity: {
          id: route.id,
          kind: "notification",
          name: route.id,
        },
        message: "This is a sample notification from Towbar.",
        occurredAt: new Date().toISOString(),
        source: null,
        title: "Test notification",
      },
      provider: "discord",
      providerConfiguration,
    });
  } catch (error) {
    if (error instanceof NotificationProviderError)
      throw new HttpError(502, error.code, error.message, { cause: error });
    throw error;
  }

  return { status: "accepted" as const };
}
