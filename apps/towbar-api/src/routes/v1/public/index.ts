import { Hono } from "hono";

import { publicAuthRoutes } from "./auth.js";
import { githubWebhookRoutes } from "./github-webhook.js";
import { gitlabWebhookRoutes } from "./gitlab-webhook.js";

export const publicRoutes = new Hono();

publicRoutes.route("/auth", publicAuthRoutes);
publicRoutes.route("/webhooks/github", githubWebhookRoutes);
publicRoutes.route("/webhooks/gitlab", gitlabWebhookRoutes);
