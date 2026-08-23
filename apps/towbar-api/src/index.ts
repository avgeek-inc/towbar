import { serve } from "@hono/node-server";

import { applyOwnerPasswordResetFromEnvironment } from "./areas/auth/service.js";
import { app, internalApp } from "./app.js";
import { getEnv } from "./env.js";
import { clearPasswordLoginAccountRateLimit } from "./http/rate-limit.js";
import { closeDatabase } from "./infrastructure/database.js";
import { wakeMaintenanceWorkflow } from "./infrastructure/temporal.js";

const env = getEnv();
const ownerReset = await applyOwnerPasswordResetFromEnvironment();
if (ownerReset.status === "applied") {
  await clearPasswordLoginAccountRateLimit(ownerReset.email);
  process.stderr.write(
    `Towbar owner password reset applied for ${ownerReset.email}. Remove TOWBAR_OWNER_RESET_EMAIL and TOWBAR_OWNER_RESET_PASSWORD, then change the temporary password in Settings.\n`,
  );
} else if (ownerReset.status === "already-applied") {
  process.stderr.write(
    `Towbar ignored the already-applied owner password reset for ${ownerReset.email}. Remove the reset environment variables.\n`,
  );
}
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

void wakeMaintenanceWorkflow().catch((error: unknown) => {
  console.error("Towbar maintenance workflow could not be started", error);
});

async function shutdown() {
  server.close();
  internalServer.close();
  await closeDatabase();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
