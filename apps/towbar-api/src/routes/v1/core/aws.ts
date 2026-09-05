import { operation } from "../../../http/operation.js";
import { Hono } from "hono";
import { z } from "zod";

import {
  deleteAwsCredentials,
  getAwsCredentialMetadata,
  saveAwsCredentials,
} from "../../../areas/aws/service.js";
import { forbidden } from "../../../http/errors.js";
import { readJson } from "../../../http/requests.js";

import type { TowbarHonoEnvironment } from "../../../http/types.js";

const credentialSchema = z
  .object({
    accessKeyId: z.string().trim().min(16).max(128),
    region: z.string().trim().min(3).max(64).default("ap-south-1"),
    secretAccessKey: z.string().min(20).max(256),
  })
  .strict();

export const awsRoutes = new Hono<TowbarHonoEnvironment>();

awsRoutes.get(
  "/",
  operation({
    responseSchema: 'aws.ts:get:"/"',
    summary: "Get AWS credential metadata",
    response: "JSON object containing canManage, credential.",
    status: 200,
  }),
  async (context) => {
    const user = context.get("user");
    const credential = await getAwsCredentialMetadata(user.workspaceId);
    return context.json({
      canManage: user.workspaceRole === "owner",
      credential,
    });
  },
);

awsRoutes.put(
  "/",
  operation({
    responseSchema: 'aws.ts:put:"/"',
    summary: "Save AWS credentials",
    body: credentialSchema,
    ownerOnly: true,
    response: "JSON object containing credential.",
    status: 200,
  }),
  async (context) => {
    requireWorkspaceOwner(context.get("user").workspaceRole);
    const input = await readJson(context, credentialSchema);
    const credential = await saveAwsCredentials({
      ...input,
      workspaceId: context.get("user").workspaceId,
    });
    return context.json({ credential });
  },
);

awsRoutes.delete(
  "/",
  operation({
    responseSchema: 'aws.ts:delete:"/"',
    summary: "Delete AWS credentials",
    ownerOnly: true,
    response: "No response body.",
    status: 204,
  }),
  async (context) => {
    requireWorkspaceOwner(context.get("user").workspaceRole);
    await deleteAwsCredentials(context.get("user").workspaceId);
    return context.body(null, 204);
  },
);

function requireWorkspaceOwner(role: "member" | "owner") {
  if (role !== "owner") {
    throw forbidden("Only administrators can manage AWS credentials");
  }
}
