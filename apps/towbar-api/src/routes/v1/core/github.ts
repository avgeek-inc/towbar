import { Hono } from "hono";
import { z } from "zod";

import {
  completeInstallation,
  createInstallationUrl,
  disconnectGitHub,
  getGitHubConnectionStatus,
  getWorkspaceGitHubRepositories,
} from "../../../areas/github/service.js";
import { readJson } from "../../../http/requests.js";

import type { TowbarHonoEnvironment } from "../../../http/types.js";

const completeSchema = z
  .object({
    installationId: z.string().regex(/^\d+$/u),
    state: z.string().min(20).max(4_096),
  })
  .strict();

export const githubRoutes = new Hono<TowbarHonoEnvironment>();

githubRoutes.get("/", async (context) => {
  const connection = await getGitHubConnectionStatus(
    context.get("user").workspaceId,
  );
  return context.json({ connection });
});

githubRoutes.post("/actions/installation-url", async (context) => {
  const user = context.get("user");
  const url = await createInstallationUrl({
    userId: user.id,
    workspaceId: user.workspaceId,
  });
  return context.json({ url });
});

githubRoutes.post("/actions/complete-installation", async (context) => {
  const input = await readJson(context, completeSchema);
  const user = context.get("user");
  const installation = await completeInstallation({
    ...input,
    userId: user.id,
    workspaceId: user.workspaceId,
  });
  return context.json({ installation }, 201);
});

githubRoutes.get("/repositories", async (context) => {
  const repositories = await getWorkspaceGitHubRepositories(
    context.get("user").workspaceId,
  );
  return context.json({ repositories });
});

githubRoutes.delete("/", async (context) => {
  await disconnectGitHub(context.get("user").workspaceId);
  return context.body(null, 204);
});
