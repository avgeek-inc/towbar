import { operation } from "../../../http/operation.js";
import { Hono } from "hono";
import { z } from "zod";

import {
  completeInstallation,
  createInstallationUrl,
  disconnectGitHub,
  getGitHubConnectionStatus,
  getWorkspaceGitHubRepositories,
} from "../../../areas/github/service.js";
import { retryFailedPreviewReporting } from "../../../areas/previews/reporting-retry.js";
import { getPreviewReportingHealth } from "../../../areas/previews/reporting-state.js";
import { readJson } from "../../../http/requests.js";

import type { TowbarHonoEnvironment } from "../../../http/types.js";

const completeSchema = z
  .object({
    installationId: z.string().regex(/^\d+$/u),
    state: z.string().min(20).max(4_096),
  })
  .strict();

export const githubRoutes = new Hono<TowbarHonoEnvironment>();

githubRoutes.get(
  "/",
  operation({
    responseSchema: 'github.ts:get:"/"',
    summary: "Get GitHub integration",
    response: "JSON object containing connection, previewReporting.",
    status: 200,
  }),
  async (context) => {
    const workspaceId = context.get("user").workspaceId;
    const [connection, previewReporting] = await Promise.all([
      getGitHubConnectionStatus(workspaceId),
      getPreviewReportingHealth(workspaceId),
    ]);
    return context.json({ connection, previewReporting });
  },
);

githubRoutes.post(
  "/actions/retry-preview-reporting",
  operation({
    responseSchema: 'github.ts:post:"/actions/retry-preview-reporting"',
    summary: "Retry failed preview reporting",
    response: "The number of preview reports queued for retry.",
    status: 200,
  }),
  async (context) => {
    const result = await retryFailedPreviewReporting(
      context.get("user").workspaceId,
    );
    return context.json(result);
  },
);

githubRoutes.post(
  "/actions/installation-url",
  operation({
    responseSchema: 'github.ts:post:"/actions/installation-url"',
    summary: "Create installation URL",
    response: "JSON object containing url.",
    status: 200,
  }),
  async (context) => {
    const user = context.get("user");
    const url = await createInstallationUrl({
      userId: user.id,
      workspaceId: user.workspaceId,
    });
    return context.json({ url });
  },
);

githubRoutes.post(
  "/actions/complete-installation",
  operation({
    responseSchema: 'github.ts:post:"/actions/complete-installation"',
    summary: "Complete installation",
    body: completeSchema,
    response: "JSON object containing installation.",
    status: 201,
  }),
  async (context) => {
    const input = await readJson(context, completeSchema);
    const user = context.get("user");
    const installation = await completeInstallation({
      ...input,
      userId: user.id,
      workspaceId: user.workspaceId,
    });
    return context.json({ installation }, 201);
  },
);

githubRoutes.get(
  "/repositories",
  operation({
    responseSchema: 'github.ts:get:"/repositories"',
    summary: "Get workspace GitHub repositories",
    response: "JSON object containing repositories.",
    status: 200,
  }),
  async (context) => {
    const repositories = await getWorkspaceGitHubRepositories(
      context.get("user").workspaceId,
    );
    return context.json({ repositories });
  },
);

githubRoutes.delete(
  "/",
  operation({
    responseSchema: 'github.ts:delete:"/"',
    summary: "Disconnect GitHub",
    response: "No response body.",
    status: 204,
  }),
  async (context) => {
    await disconnectGitHub(context.get("user").workspaceId);
    return context.body(null, 204);
  },
);
