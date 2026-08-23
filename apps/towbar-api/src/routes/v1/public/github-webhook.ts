import { Hono } from "hono";

import { processGitHubWebhook } from "../../../areas/github/webhooks.js";
import { readText } from "../../../http/requests.js";

export const githubWebhookRoutes = new Hono();
const webhookBodyLimitBytes = 2 * 1_024 * 1_024;

githubWebhookRoutes.post("/", async (context) => {
  const result = await processGitHubWebhook({
    body: await readText(context, webhookBodyLimitBytes),
    deliveryId: context.req.header("x-github-delivery"),
    eventName: context.req.header("x-github-event"),
    signature: context.req.header("x-hub-signature-256"),
  });
  return context.json(result, 202);
});
