import assert from "node:assert/strict";
import test from "node:test";

import type { NotificationEvent } from "@workspace/towbar-web-client";
import { notificationHref } from "./notification-route.js";

function notification(
  kind: string,
  options: {
    details?: NotificationEvent["payload"]["details"];
    sourceId?: string;
    type?: string;
  } = {},
) {
  return {
    type: options.type ?? "runtime.unhealthy",
    payload: {
      details: options.details ?? {},
      entity: { id: "entity-id", kind, name: "Entity" },
      message: "Message",
      occurredAt: "2026-09-23T12:00:00.000Z",
      source: options.sourceId
        ? { id: options.sourceId, name: "Repository" }
        : null,
      title: "Title",
    },
  } satisfies Pick<NotificationEvent, "payload" | "type">;
}

void test("links deployment notifications to their canonical detail page", () => {
  assert.equal(
    notificationHref(
      notification("deployment", {
        details: { deployableId: "app-id", deployableKind: "app" },
        sourceId: "source-id",
        type: "deployment.succeeded",
      }),
    ),
    "/apps/app-id/deployments/entity-id",
  );
  assert.equal(
    notificationHref(
      notification("deployment", {
        details: { deployableId: "resource-id", deployableKind: "redis" },
        sourceId: "source-id",
        type: "deployment.failed",
      }),
    ),
    "/resources/resource-id/deployments/entity-id",
  );
});

void test("uses repository deployment routing for existing notification data", () => {
  assert.equal(
    notificationHref(
      notification("deployment", {
        sourceId: "source-id",
        type: "deployment.started",
      }),
    ),
    "/repositories/source-id/deployments/entity-id",
  );
});

void test("links operational notifications to the relevant page", () => {
  assert.equal(
    notificationHref(notification("server")),
    "/servers/entity-id/overview",
  );
  assert.equal(
    notificationHref(notification("backup", { type: "backup.failed" })),
    "/resources/entity-id/settings/backup",
  );
  assert.equal(
    notificationHref(
      notification("server", {
        details: {
          configuration: "https://towbar.example/manage/integrations/axiom",
        },
        type: "log-drain.auth_failure",
      }),
    ),
    "/manage/integrations/axiom",
  );
});
