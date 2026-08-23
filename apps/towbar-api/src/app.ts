import { randomUUID } from "node:crypto";

import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { ZodError } from "zod";

import { ManifestValidationError } from "@workspace/towbar-core";
import { httpObservabilityMiddleware } from "@workspace/observability-node/hono";

import { getAllowedOrigins, getEnv } from "./env.js";
import { HttpError } from "./http/errors.js";
import { pingDatabase } from "./infrastructure/database.js";
import { internalV1, publicV1 } from "./routes/v1/index.js";

import type { HttpErrorStatus } from "./http/errors.js";
import type { TowbarHonoEnvironment } from "./http/types.js";

function createRoutedApp(routeScope: "internal" | "public") {
  const app = new Hono<TowbarHonoEnvironment>();
  app.use("*", httpObservabilityMiddleware());
  app.use("*", secureHeaders());
  app.use("*", async (context, next) => {
    const suppliedRequestId = context.req.header("x-request-id");
    const requestId = isValidRequestId(suppliedRequestId)
      ? suppliedRequestId
      : randomUUID();
    context.set("requestId", requestId);
    context.header("x-request-id", requestId);
    await next();
  });
  app.use(
    "/v1/*",
    cors({
      allowHeaders: [
        "Content-Type",
        "Idempotency-Key",
        "X-Towbar-Nonce",
        "X-Towbar-Signature",
        "X-Towbar-Timestamp",
      ],
      allowMethods: ["DELETE", "GET", "OPTIONS", "PATCH", "POST", "PUT"],
      credentials: true,
      origin: (origin) => (getAllowedOrigins().has(origin) ? origin : ""),
    }),
  );

  app.get("/health", async (context) => {
    try {
      await pingDatabase();
      return context.json({
        service: "towbar-api",
        status: "ok",
        version: getEnv().TOWBAR_COMMIT_SHA ?? getEnv().SOURCE_COMMIT,
      });
    } catch {
      return context.json({ service: "towbar-api", status: "degraded" }, 503);
    }
  });

  app.route("/v1", routeScope === "internal" ? internalV1 : publicV1);
  app.notFound((context) =>
    context.json(
      {
        error: {
          code: "NOT_FOUND",
          message: "Route was not found",
          requestId: context.get("requestId"),
        },
      },
      404,
    ),
  );
  app.onError((error, context) => {
    const { code, headers, message, status } = normalizeError(error);
    if (status >= 500) console.error(error);
    for (const [name, value] of Object.entries(headers ?? {})) {
      context.header(name, value);
    }
    return context.json(
      {
        error: {
          code,
          message,
          requestId: context.get("requestId") ?? randomUUID(),
        },
      },
      status,
    );
  });
  return app;
}

export function createApp() {
  return createRoutedApp("public");
}

export function createInternalApp() {
  return createRoutedApp("internal");
}

function normalizeError(error: Error): {
  code: string;
  headers?: Record<string, string>;
  message: string;
  status: HttpErrorStatus;
} {
  if (error instanceof HttpError) {
    return {
      code: error.code,
      headers: error.responseHeaders,
      message: error.publicMessage,
      status: error.status,
    };
  }
  if (error instanceof ZodError) {
    return {
      code: "INVALID_REQUEST",
      message: error.issues[0]?.message ?? "Request is invalid",
      status: 400,
    };
  }
  if (error instanceof ManifestValidationError) {
    return {
      code: "INVALID_MANIFEST",
      message: error.issues[0]?.message ?? error.message,
      status: 422,
    };
  }
  return { code: "INTERNAL_ERROR", message: "Towbar API error", status: 500 };
}

function isValidRequestId(value: string | undefined): value is string {
  return Boolean(
    value && value.length <= 100 && /^[A-Za-z0-9._:-]+$/u.test(value),
  );
}

export const app = createApp();
export const internalApp = createInternalApp();
