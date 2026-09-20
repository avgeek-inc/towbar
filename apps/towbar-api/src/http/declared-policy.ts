import { matchedRoutes } from "hono/route";
import { operationDescription } from "./operation.js";
import type { MiddlewareHandler } from "hono";
import type { TowbarHonoEnvironment } from "./types.js";
export const requireDeclaredPolicy: MiddlewareHandler<
  TowbarHonoEnvironment
> = async (context, next) => {
  if (
    !matchedRoutes(context).some(
      (route) => operationDescription(route.handler)?.permissions.length,
    )
  )
    return context.notFound();
  await next();
};
