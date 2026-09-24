import { randomUUID } from "node:crypto";

import { HttpError, badRequest, notFound } from "../../http/errors.js";
import { getRuntimeNotificationProvider } from "../../infrastructure/runtime-notifications.js";
import { listSlackDestinations } from "./slack-destinations.js";
import { NotificationProviderError, deliverNotification } from "./providers.js";

const defaultDependencies = {
  getProvider: () => getRuntimeNotificationProvider("slack"),
  listDestinations: listSlackDestinations,
  deliver: deliverNotification,
};

export async function sendTestSlackDestination(
  workspaceId: string,
  channelId: string,
  dependencies: {
    getProvider: typeof defaultDependencies.getProvider;
    listDestinations: (
      workspaceId: string,
    ) => Promise<Array<{ id: string; channelId: string }>>;
    deliver: (
      input: Parameters<typeof deliverNotification>[0],
    ) => Promise<unknown>;
  } = defaultDependencies,
) {
  const providerConfiguration = dependencies.getProvider();
  if (!providerConfiguration)
    throw badRequest(
      "Configure Slack bot credentials in the runtime before testing channels",
      "SLACK_NOT_CONFIGURED",
    );

  const destination = (await dependencies.listDestinations(workspaceId)).find(
    (row) => row.channelId === channelId,
  );
  if (!destination) throw notFound("Slack destination");

  try {
    await dependencies.deliver({
      config: { channelId: destination.channelId },
      eventId: randomUUID(),
      eventType: "notification.test",
      payload: {
        details: {},
        entity: {
          id: destination.id,
          kind: "notification",
          name: destination.channelId,
        },
        message: "This is a sample notification from Towbar.",
        occurredAt: new Date().toISOString(),
        source: null,
        title: "Test notification",
      },
      provider: "slack",
      providerConfiguration,
    });
  } catch (error) {
    if (error instanceof NotificationProviderError)
      throw new HttpError(502, error.code, error.message, { cause: error });
    throw error;
  }

  return { status: "accepted" as const };
}
