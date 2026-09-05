import { z } from "zod";
import type { MiddlewareHandler } from "hono";
import type { TowbarHonoEnvironment } from "./types.js";

export type OperationDescription = {
  summary: string;
  body?: z.ZodType;
  query?: z.ZodType;
  ownerOnly?: boolean;
  idempotencyKey?: boolean;
  response: string;
  responseSchema: string;
  status?: number;
  additionalStatuses?: number[];
  stream?: boolean;
  browserOnly?: boolean;
};
const descriptions = new WeakMap<
  MiddlewareHandler<TowbarHonoEnvironment>,
  OperationDescription
>();
/** Describe a route beside its handler; REST docs and MCP use the same input schema. */
export function operation(
  description: OperationDescription,
): MiddlewareHandler<TowbarHonoEnvironment> {
  const middleware: MiddlewareHandler<TowbarHonoEnvironment> = async (
    context,
    next,
  ) => {
    if (description.browserOnly && context.get("apiKey"))
      return context.notFound();
    for (const [name, value] of Object.entries(context.req.param())) {
      if (/Id$/.test(name)) z.uuid().parse(value);
    }
    await next();
  };
  descriptions.set(middleware, description);
  return middleware;
}
export function operationDescription(
  handler: MiddlewareHandler<TowbarHonoEnvironment>,
) {
  return descriptions.get(handler);
}
