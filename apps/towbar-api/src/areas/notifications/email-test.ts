import { randomUUID } from "node:crypto";

import { HttpError, badRequest, notFound } from "../../http/errors.js";
import { getRuntimeNotificationProvider } from "../../infrastructure/runtime-notifications.js";
import { listEmailDestinations } from "./email-destinations.js";
import { NotificationProviderError, deliverNotification } from "./providers.js";

const defaultDependencies = {
  getProvider: () => getRuntimeNotificationProvider("smtp"),
  listDestinations: listEmailDestinations,
  deliver: deliverNotification,
};

export async function sendTestEmailDestination(
  workspaceId: string,
  email: string,
  dependencies: {
    getProvider: typeof defaultDependencies.getProvider;
    listDestinations: (
      workspaceId: string,
    ) => Promise<Array<{ id: string; email: string }>>;
    deliver: (
      input: Parameters<typeof deliverNotification>[0],
    ) => Promise<unknown>;
  } = defaultDependencies,
) {
  const providerConfiguration = dependencies.getProvider();
  if (!providerConfiguration)
    throw badRequest(
      "Configure SMTP in the runtime before testing email destinations",
      "SMTP_NOT_CONFIGURED",
    );

  const destination = (await dependencies.listDestinations(workspaceId)).find(
    (row) => row.email === email.toLowerCase(),
  );
  if (!destination) throw notFound("Email destination");

  try {
    await dependencies.deliver({
      config: { recipients: [destination.email] },
      eventId: randomUUID(),
      eventType: "notification.test",
      payload: {
        details: {},
        entity: {
          id: destination.id,
          kind: "notification",
          name: destination.email,
        },
        message: "This is a sample notification from Towbar.",
        occurredAt: new Date().toISOString(),
        source: null,
        title: "Test notification",
      },
      provider: "smtp",
      providerConfiguration,
    });
  } catch (error) {
    if (error instanceof NotificationProviderError)
      throw new HttpError(502, error.code, error.message, { cause: error });
    throw error;
  }

  return { status: "accepted" as const };
}
