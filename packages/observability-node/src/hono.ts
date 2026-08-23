import { createMiddleware } from "hono/factory";

export const httpObservabilityMiddleware = () =>
  createMiddleware(async (context, next) => {
    const startedAt = performance.now();
    await next();
    context.header(
      "server-timing",
      `app;dur=${(performance.now() - startedAt).toFixed(1)}`,
    );
  });
