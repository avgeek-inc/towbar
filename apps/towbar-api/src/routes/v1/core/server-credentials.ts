import { createPrivateKey } from "node:crypto";
import { Hono } from "hono";
import { secretMutationSchema } from "@workspace/towbar-core";
import {
  mutateSecret,
  readSecretMetadata,
  requireSecretOwner,
} from "../../../areas/secrets/store.js";
import { forbidden, unprocessable } from "../../../http/errors.js";
import { readJson, readUuidPathParameter } from "../../../http/requests.js";
import type { TowbarHonoEnvironment } from "../../../http/types.js";

export const serverCredentialRoutes = new Hono<TowbarHonoEnvironment>();
serverCredentialRoutes.get("/", async (context) => {
  const user = context.get("user");
  const slot = {
    type: "server" as const,
    id: readUuidPathParameter(context.req.param("serverId")!, "serverId"),
    workspaceId: user.workspaceId,
    environment: "production" as const,
    stage: "credentials",
  };
  await requireSecretOwner(slot);
  context.header("Cache-Control", "no-store");
  return context.json({
    credential: await readSecretMetadata(slot),
    canManage: user.workspaceRole === "owner",
  });
});
serverCredentialRoutes.patch("/", async (context) => {
  const user = context.get("user");
  if (user.workspaceRole !== "owner")
    throw forbidden("Only the owner can manage server credentials");
  const mutation = await readJson(context, secretMutationSchema, 300 * 1024);
  const slot = {
    type: "server" as const,
    id: readUuidPathParameter(context.req.param("serverId")!, "serverId"),
    workspaceId: user.workspaceId,
    environment: "production" as const,
    stage: "credentials",
  };
  const credential = await mutateSecret(slot, mutation, user.id, (values) => {
    if (
      Object.keys(values).some(
        (key) => !["privateKey", "apiToken"].includes(key),
      )
    )
      throw unprocessable("Only privateKey and apiToken are supported");
    if (values.privateKey !== undefined) {
      if (!values.privateKey.trim())
        throw unprocessable("Enter an SSH private key or remove the key");
      // OpenSSH keys are validated by the SSH client; PEM keys can be parsed here.
      if (!values.privateKey.includes("-----BEGIN OPENSSH PRIVATE KEY-----")) {
        try {
          createPrivateKey(values.privateKey);
        } catch {
          throw unprocessable("Enter a valid unencrypted SSH private key");
        }
      }
    }
    if (
      values.apiToken !== undefined &&
      !/^cfat_[A-Za-z0-9_-]{32,256}$/u.test(values.apiToken)
    )
      throw unprocessable(
        "Enter a Cloudflare Account API token starting with cfat_. Create or roll it under Manage Account → Account API Tokens; personal and legacy unprefixed tokens are not supported.",
      );
  });
  context.header("Cache-Control", "no-store");
  return context.json({ credential });
});
