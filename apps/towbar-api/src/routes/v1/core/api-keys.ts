import { operation } from "../../../http/operation.js";
import { Hono } from "hono";
import { z } from "zod";
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
} from "../../../areas/api-keys/service.js";
import { getEnv } from "../../../env.js";
import { forbidden } from "../../../http/errors.js";
import { readJson, readUuidPathParameter } from "../../../http/requests.js";
import type { TowbarHonoEnvironment } from "../../../http/types.js";

const createKeySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    purpose: z.enum(["api", "mcp", "both"]),
    access: z.enum(["read", "write"]),
    expiresAt: z.iso
      .datetime()
      .refine(
        (value) => Date.parse(value) > Date.now(),
        "Expiry must be in the future",
      )
      .nullable()
      .optional(),
  })
  .strict();
export const apiKeyRoutes = new Hono<TowbarHonoEnvironment>();
apiKeyRoutes.use("*", async (context, next) => {
  context.header("Cache-Control", "no-store");
  await next();
});
apiKeyRoutes.get(
  "/",
  operation({
    responseSchema: 'api-keys.ts:get:"/"',
    summary: "List API keys",
    response: "JSON object containing keys, apiUrl, mcpUrl, rateLimit.",
    status: 200,
  }),
  async (context) => {
    const env = getEnv();
    return context.json({
      keys: await listApiKeys(context.get("user")),
      apiUrl: `${env.TOWBAR_API_BASE_URL}/v1/api`,
      mcpUrl: `${env.TOWBAR_API_BASE_URL}/v1/mcp`,
      rateLimit: {
        requests: env.TOWBAR_API_RATE_LIMIT_MAX,
        windowSeconds: env.TOWBAR_API_RATE_LIMIT_WINDOW_SECONDS,
      },
    });
  },
);
apiKeyRoutes.post(
  "/",
  operation({
    responseSchema: 'api-keys.ts:post:"/"',
    summary: "Create API key",
    body: createKeySchema,
    response:
      "Key metadata and the one-time token. Save the token now; it cannot be retrieved later.",
    status: 201,
  }),
  async (context) => {
    const input = await readJson(context, createKeySchema);
    const parent = context.get("apiKey");
    if (
      parent &&
      (parent.access !== "write" ||
        (parent.purpose !== "both" && input.purpose !== parent.purpose))
    )
      throw forbidden(
        "A key cannot grant access beyond its own purpose and permissions",
      );
    return context.json(await createApiKey(context.get("user"), input), 201);
  },
);
apiKeyRoutes.delete(
  "/:keyId",
  operation({
    responseSchema: 'api-keys.ts:delete:"/:keyId"',
    summary: "Revoke API key",
    response: "No response body.",
    status: 204,
  }),
  async (context) => {
    await revokeApiKey(
      context.get("user"),
      readUuidPathParameter(context.req.param("keyId"), "keyId"),
    );
    return context.body(null, 204);
  },
);
