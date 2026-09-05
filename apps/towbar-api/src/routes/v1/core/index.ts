import { apiKeyRoutes } from "./api-keys.js";
import { environmentSecretRoutes } from "./environment-secrets.js";
import { serverCredentialRoutes } from "./server-credentials.js";
import { Hono } from "hono";

import {
  requireAuthenticatedUser,
  requireTrustedMutationOrigin,
} from "../../../http/authentication.js";
import { accountRoutes } from "./account.js";
import { appRoutes } from "./apps.js";
import { deploymentRoutes } from "./deployments.js";
import { awsRoutes } from "./aws.js";
import { githubRoutes } from "./github.js";
import { sessionRoutes } from "./session.js";
import { serverRoutes } from "./servers.js";
import { resourceRoutes } from "./resources.js";
import { previewRoutes } from "./previews.js";
import { sourceRoutes } from "./sources.js";
import { systemHealthRoutes } from "./system-health.js";
import { notificationRoutes } from "./notifications.js";
import { notificationCenterRoutes } from "./notification-center.js";

import type { TowbarHonoEnvironment } from "../../../http/types.js";

export const controlPlaneRoutes = new Hono<TowbarHonoEnvironment>();

controlPlaneRoutes.route("/settings/api-keys", apiKeyRoutes);
controlPlaneRoutes.route("/github", githubRoutes);
controlPlaneRoutes.route("/aws", awsRoutes);
controlPlaneRoutes.route(
  "/sources/:sourceId/notifications",
  notificationRoutes,
);
controlPlaneRoutes.route("/notifications", notificationCenterRoutes);
controlPlaneRoutes.route(
  "/settings/secrets",
  environmentSecretRoutes("workspace"),
);
controlPlaneRoutes.route(
  "/sources/:ownerId/secrets",
  environmentSecretRoutes("source"),
);
controlPlaneRoutes.route(
  "/apps/:ownerId/secrets",
  environmentSecretRoutes("app"),
);
controlPlaneRoutes.route(
  "/resources/:ownerId/secrets",
  environmentSecretRoutes("resource"),
);
controlPlaneRoutes.route(
  "/servers/:serverId/credentials",
  serverCredentialRoutes,
);
controlPlaneRoutes.route("/sources", sourceRoutes);
controlPlaneRoutes.route("/apps", appRoutes);
controlPlaneRoutes.route("/resources", resourceRoutes);
controlPlaneRoutes.route("/previews", previewRoutes);
controlPlaneRoutes.route("/servers", serverRoutes);
controlPlaneRoutes.route("/deployments", deploymentRoutes);
controlPlaneRoutes.route("/system-health", systemHealthRoutes);
controlPlaneRoutes.route("/", accountRoutes);

export const coreRoutes = new Hono<TowbarHonoEnvironment>();
coreRoutes.use("*", requireTrustedMutationOrigin);
coreRoutes.use("*", requireAuthenticatedUser);
coreRoutes.route("/session", sessionRoutes);
coreRoutes.route("/", controlPlaneRoutes);
