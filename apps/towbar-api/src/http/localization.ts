import {
  defaultDateTimePreferences,
  localizedResponse,
} from "@workspace/towbar-core/date-time";
import type { Context, MiddlewareHandler } from "hono";
import type { TowbarHonoEnvironment } from "./types.js";

export function requestDateTimePreferences(
  context: Context<TowbarHonoEnvironment>,
) {
  const user = context.get("user");
  return context.get("actor")?.kind === "team-key" || !user?.id
    ? defaultDateTimePreferences
    : (user.dateTimePreferences ?? defaultDateTimePreferences);
}

export const localizeJsonResponse: MiddlewareHandler<
  TowbarHonoEnvironment
> = async (context, next) => {
  await next();
  if (
    !context.res.headers.get("content-type")?.includes("application/json") ||
    context.res.status === 204
  )
    return;
  const value: unknown = await context.res.clone().json();
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const headers = new Headers(context.res.headers);
  headers.delete("content-length");
  headers.set("Cache-Control", "private, no-store");
  context.res = new Response(
    JSON.stringify(
      localizedResponse(
        value as Record<string, unknown>,
        requestDateTimePreferences(context),
      ),
    ),
    {
      status: context.res.status,
      headers,
    },
  );
};
