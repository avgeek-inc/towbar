import { Hono } from "hono";

import { coreRoutes } from "./core/index.js";
import { internalRoutes } from "./internal/index.js";
import { publicRoutes } from "./public/index.js";

import type { TowbarHonoEnvironment } from "../../http/types.js";

export const v1 = new Hono<TowbarHonoEnvironment>();

v1.route("/public", publicRoutes);
v1.route("/core", coreRoutes);
v1.route("/internal", internalRoutes);
