import { notificationSettingsRoutes } from "./notification-settings.js";
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

export const coreRoutes = new Hono<TowbarHonoEnvironment>();

coreRoutes.use("*", requireTrustedMutationOrigin);
coreRoutes.use("*", requireAuthenticatedUser);
coreRoutes.route("/session", sessionRoutes);
coreRoutes.route("/github", githubRoutes);
coreRoutes.route("/sources/:sourceId/aws", awsRoutes);
coreRoutes.route("/sources/:sourceId/notifications", notificationRoutes);
coreRoutes.route("/notifications", notificationCenterRoutes);
coreRoutes.route("/settings/notifications", notificationSettingsRoutes);
coreRoutes.route(
  "/sources/:ownerId/secrets",
  environmentSecretRoutes("source"),
);
coreRoutes.route("/apps/:ownerId/secrets", environmentSecretRoutes("app"));
coreRoutes.route(
  "/resources/:ownerId/secrets",
  environmentSecretRoutes("resource"),
);
coreRoutes.route("/servers/:serverId/credentials", serverCredentialRoutes);
coreRoutes.route("/sources", sourceRoutes);
coreRoutes.route("/apps", appRoutes);
coreRoutes.route("/resources", resourceRoutes);
coreRoutes.route("/previews", previewRoutes);
coreRoutes.route("/servers", serverRoutes);
coreRoutes.route("/deployments", deploymentRoutes);
coreRoutes.route("/system-health", systemHealthRoutes);
coreRoutes.route("/", accountRoutes);
