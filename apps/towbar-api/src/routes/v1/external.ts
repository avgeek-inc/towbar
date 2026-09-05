import { Hono } from "hono";
import {
  externalRateLimit,
  requireApiKey,
} from "../../http/api-authentication.js";
import { controlPlaneRoutes } from "./core/index.js";
import { createOpenApiDocument } from "../../areas/external-api/catalogue.js";
import { getEnv } from "../../env.js";
import type { TowbarHonoEnvironment } from "../../http/types.js";
export const externalApiRoutes = new Hono<TowbarHonoEnvironment>();
externalApiRoutes.use("*", externalRateLimit);
externalApiRoutes.use("*", requireApiKey("api"));
externalApiRoutes.get("/openapi.json", (context) =>
  context.json(createOpenApiDocument(`${getEnv().TOWBAR_API_BASE_URL}/v1/api`)),
);
externalApiRoutes.route("/", controlPlaneRoutes);
