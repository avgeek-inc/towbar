import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import type { ManifestNotifications } from "@workspace/towbar-core";
import {
  apps,
  notificationDeliveries,
  notificationEvents,
} from "@workspace/towbar-database/schema";

import { getTowbarDatabase } from "../../infrastructure/database.js";
import { getRuntimeNotifications } from "../../infrastructure/runtime-notifications.js";
import {
  deliveriesQuery,
  listNotificationDeliveries,
} from "../event-history/deliveries.js";
import { manifestNotificationRoutesForApp } from "../notifications/manifest-destinations.js";

export async function assertManifestNotificationSync(input: {
  stageId: string;
  workspaceId: string;
  sync: () => Promise<unknown>;
  setNotifications: (value: ManifestNotifications | undefined) => void;
}) {
  const runtime = getRuntimeNotifications({
    TOWBAR_NOTIFICATIONS_ENABLED: "true",
    TOWBAR_NOTIFICATION_CONFIG_JSON: JSON.stringify({
      providers: {
        smtp: {
          from: "towbar@example.com",
          host: "smtp.example.com",
          port: 587,
          secure: false,
        },
      },
      routes: [],
    }),
  });
  const notifications: ManifestNotifications = {
    email: [
      {
        address: "ops@example.com",
        deployments: true,
        backupsAndRestores: false,
        alertsAndIncidents: true,
      },
    ],
  };
  input.setNotifications(notifications);
  await input.sync();
  const [configured] = await getTowbarDatabase()
    .select({ config: apps.config })
    .from(apps)
    .where(eq(apps.id, input.stageId));
  assert.deepEqual(configured?.config.notifications, notifications);
  assert.equal(
    (
      await manifestNotificationRoutesForApp(
        input.stageId,
        input.workspaceId,
        runtime,
      )
    ).length,
    1,
  );
  input.setNotifications(undefined);
  await input.sync();
  const [removed] = await getTowbarDatabase()
    .select({ config: apps.config })
    .from(apps)
    .where(eq(apps.id, input.stageId));
  assert.equal(removed?.config.notifications, undefined);
  assert.deepEqual(
    await manifestNotificationRoutesForApp(
      input.stageId,
      input.workspaceId,
      runtime,
    ),
    [],
  );
}

export async function assertScopedDeliveryHistory(input: {
  workspaceId: string;
  sourceId: string;
  stage: { id: string; name: string };
  production: { id: string; name: string };
}) {
  const records = await getTowbarDatabase()
    .insert(notificationEvents)
    .values(
      [input.stage, input.production].map((instance) => ({
        workspaceId: input.workspaceId,
        sourceId: input.sourceId,
        category: "deployments" as const,
        type: "deployment.succeeded" as const,
        dedupeKey: `manifest-delivery:${instance.id}`,
        occurredAt: new Date(),
        payload: {
          title: "Deployment succeeded",
          message: "The deployment succeeded.",
          occurredAt: new Date().toISOString(),
          source: { id: input.sourceId, name: "Site" },
          entity: {
            id: instance.id,
            kind: "deployment" as const,
            name: instance.name,
          },
          details: { deployableId: instance.id },
        },
      })),
    )
    .returning({ id: notificationEvents.id });
  const deliveries = await getTowbarDatabase()
    .insert(notificationDeliveries)
    .values(
      records.map((event, index) => ({
        eventId: event.id,
        destinationKey: `manifest-test-${index}`,
        provider: "smtp" as const,
      })),
    )
    .returning({ id: notificationDeliveries.id });
  const query = deliveriesQuery.parse({});
  const scoped = await listNotificationDeliveries({
    ...query,
    entityId: input.stage.id,
    workspaceId: input.workspaceId,
  });
  const global = await listNotificationDeliveries({
    ...query,
    workspaceId: input.workspaceId,
  });
  assert(scoped.items.some((item) => item.id === deliveries[0]?.id));
  assert(!scoped.items.some((item) => item.id === deliveries[1]?.id));
  assert(global.items.some((item) => item.id === deliveries[0]?.id));
  assert(global.items.some((item) => item.id === deliveries[1]?.id));
}
