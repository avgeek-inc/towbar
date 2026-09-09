import { operation } from "../../../http/operation.js";
import { Hono } from "hono";
import { z } from "zod";

import {
  deleteGcpCredentials,
  getGcpCredentialMetadata,
  saveGcpCredentials,
} from "../../../areas/gcp/service.js";
import { forbidden } from "../../../http/errors.js";
import { readJson } from "../../../http/requests.js";

import type { TowbarHonoEnvironment } from "../../../http/types.js";

const credentialSchema = z
  .object({
    serviceAccountKey: z.string().min(20),
  })
  .strict();

export const gcpRoutes = new Hono<TowbarHonoEnvironment>();

gcpRoutes.get(
  "/",
  operation({
    responseSchema: 'gcp.ts:get:"/"',
    summary: "Get GCP credential metadata",
    response: "JSON object containing canManage, credential.",
    status: 200,
  }),
  async (context) => {
    const user = context.get("user");
    const credential = await getGcpCredentialMetadata(user.workspaceId);
    return context.json({
      canManage: user.workspaceRole === "owner",
      credential,
    });
  },
);

gcpRoutes.put(
  "/",
  operation({
    responseSchema: 'gcp.ts:put:"/"',
    summary: "Save GCP credentials",
    body: credentialSchema,
    ownerOnly: true,
    response: "JSON object containing credential.",
    status: 200,
  }),
  async (context) => {
    requireWorkspaceOwner(context.get("user").workspaceRole);
    const input = await readJson(context, credentialSchema);
    const credential = await saveGcpCredentials({
      ...input,
      workspaceId: context.get("user").workspaceId,
    });
    return context.json({ credential });
  },
);

gcpRoutes.delete(
  "/",
  operation({
    responseSchema: 'gcp.ts:delete:"/"',
    summary: "Delete GCP credentials",
    ownerOnly: true,
    response: "No response body.",
    status: 204,
  }),
  async (context) => {
    requireWorkspaceOwner(context.get("user").workspaceRole);
    await deleteGcpCredentials(context.get("user").workspaceId);
    return context.body(null, 204);
  },
);

function requireWorkspaceOwner(role: "member" | "owner") {
  if (role !== "owner") {
    throw forbidden("Only administrators can manage GCP credentials");
  }
}
