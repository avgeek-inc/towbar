import { attachServerTerminal } from "./areas/servers/terminal-transport.js";
import { runTemporalHealthCheck } from "./areas/system-health/service.js";
import type { Server } from "node:http";
import {
  wakeAppJobsWorkflow,
  wakeLogDrainsWorkflow,
} from "./infrastructure/temporal.js";
import { serve } from "@hono/node-server";

import { app, internalApp } from "./app.js";
import { getEnv } from "./env.js";
import { closeDatabase } from "./infrastructure/database.js";
import { getRuntimeIntegrations } from "./infrastructure/runtime-integrations.js";
import { getRuntimeLogDrains } from "./infrastructure/runtime-log-drains.js";
import { getRuntimeNotifications } from "./infrastructure/runtime-notifications.js";
import {
  closeTemporalClient,
  wakeScoutAlertsWorkflow,
} from "./infrastructure/temporal.js";

const env = getEnv();
getRuntimeIntegrations();
getRuntimeLogDrains();
getRuntimeNotifications();
const server = serve(
  {
    fetch: app.fetch,
    hostname: "0.0.0.0",
    port: env.PORT,
  },
  (info) => {
    process.stdout.write(
      `Towbar API listening on http://localhost:${info.port}\n`,
    );
  },
);
const closeTerminals = attachServerTerminal(server as Server);
const internalServer = serve(
  {
    fetch: internalApp.fetch,
    hostname: "0.0.0.0",
    port: env.TOWBAR_INTERNAL_API_PORT,
  },
  (info) => {
    process.stdout.write(
      `Towbar internal API listening on container port ${info.port}\n`,
    );
  },
);

let temporalHealthCheckRunning = false;
function checkTemporalHealth() {
  if (temporalHealthCheckRunning) return;
  temporalHealthCheckRunning = true;
  void runTemporalHealthCheck()
    .catch((error: unknown) => {
      console.error(
        "Towbar Temporal health check could not be recorded",
        error,
      );
    })
    .finally(() => {
      temporalHealthCheckRunning = false;
    });
}
checkTemporalHealth();
const temporalHealthCheckTimer = setInterval(checkTemporalHealth, 5 * 60_000);
void wakeScoutAlertsWorkflow().catch((error: unknown) => {
  console.error("Scout alert workflow could not be started", error);
});

async function shutdown() {
  clearInterval(temporalHealthCheckTimer);
  closeTerminals();
  server.close();
  internalServer.close();
  await closeTemporalClient();
  await closeDatabase();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

void wakeAppJobsWorkflow().catch((error: unknown) => {
  console.error("Unable to start app job scheduler", error);
});

void wakeLogDrainsWorkflow().catch(() =>
  console.error("Unable to start log forwarding scheduler"),
);
