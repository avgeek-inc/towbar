import { Hono } from "hono";
import { processGitLabWebhook } from "../../../areas/gitlab/webhooks.js";
import { readText } from "../../../http/requests.js";

export const gitlabWebhookRoutes = new Hono();
const webhookBodyLimitBytes = 2 * 1_024 * 1_024;

gitlabWebhookRoutes.post("/:connectionId", async (context) => {
  const result = await processGitLabWebhook({
    body: await readText(context, webhookBodyLimitBytes),
    connectionId: context.req.param("connectionId"),
    deliveryId: context.req.header("x-gitlab-event-uuid"),
    eventName: context.req.header("x-gitlab-event"),
    token: context.req.header("x-gitlab-token"),
  });
  return context.json(result, 202);
});
