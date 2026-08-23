import { Hono } from "hono";

import { requireSignedInternalRequest } from "../../../http/internal-authentication.js";
import { internalDeploymentRoutes } from "./deployments.js";
import { internalMaintenanceRoutes } from "./maintenance.js";
import { internalResourceOperationRoutes } from "./resource-operations.js";
import { internalServerCheckRoutes } from "./server-checks.js";
import { internalSourceSyncRoutes } from "./source-syncs.js";

export const internalRoutes = new Hono();

internalRoutes.use("*", requireSignedInternalRequest);
internalRoutes.get("/health", (context) => context.json({ status: "ok" }));
internalRoutes.route("/source-syncs", internalSourceSyncRoutes);
internalRoutes.route("/deployments", internalDeploymentRoutes);
internalRoutes.route("/server-checks", internalServerCheckRoutes);
internalRoutes.route("/resource-operations", internalResourceOperationRoutes);
internalRoutes.route("/maintenance", internalMaintenanceRoutes);
