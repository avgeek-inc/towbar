import { operation } from "../../../http/operation.js";
import { Hono } from "hono";
import { z } from "zod";

import {
  deleteAzureCredentials,
  getAzureCredentialMetadata,
  saveAzureCredentials,
} from "../../../areas/azure/service.js";
import { forbidden } from "../../../http/errors.js";
import { readJson } from "../../../http/requests.js";

import type { TowbarHonoEnvironment } from "../../../http/types.js";

const credentialSchema = z
  .object({
    clientId: z.string().trim().min(8).max(64),
    clientSecret: z.string().min(10).max(256),
    tenantId: z.string().trim().min(8).max(64),
  })
  .strict();

export const azureRoutes = new Hono<TowbarHonoEnvironment>();

azureRoutes.get(
  "/",
  operation({
    responseSchema: 'azure.ts:get:"/"',
    summary: "Get Azure credential metadata",
    response: "JSON object containing canManage, credential.",
    status: 200,
  }),
  async (context) => {
    const user = context.get("user");
    const credential = await getAzureCredentialMetadata(user.workspaceId);
    return context.json({
      canManage: user.workspaceRole === "owner",
      credential,
    });
  },
);

azureRoutes.put(
  "/",
  operation({
    responseSchema: 'azure.ts:put:"/"',
    summary: "Save Azure credentials",
    body: credentialSchema,
    ownerOnly: true,
    response: "JSON object containing credential.",
    status: 200,
  }),
  async (context) => {
    requireWorkspaceOwner(context.get("user").workspaceRole);
    const input = await readJson(context, credentialSchema);
    const credential = await saveAzureCredentials({
      ...input,
      workspaceId: context.get("user").workspaceId,
    });
    return context.json({ credential });
  },
);

azureRoutes.delete(
  "/",
  operation({
    responseSchema: 'azure.ts:delete:"/"',
    summary: "Delete Azure credentials",
    ownerOnly: true,
    response: "No response body.",
    status: 204,
  }),
  async (context) => {
    requireWorkspaceOwner(context.get("user").workspaceRole);
    await deleteAzureCredentials(context.get("user").workspaceId);
    return context.body(null, 204);
  },
);

function requireWorkspaceOwner(role: "member" | "owner") {
  if (role !== "owner") {
    throw forbidden("Only administrators can manage Azure credentials");
  }
}
