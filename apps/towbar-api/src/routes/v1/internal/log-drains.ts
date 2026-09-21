import { reportLogDrainHealth } from "../../../areas/log-drains/health.js";
import { Hono } from "hono";
import { z } from "zod";
import {
  logDrainHealthListSchema,
  logDrainProviderSchema,
  logDrainProviders,
} from "@workspace/towbar-core";
import {
  completeLogDrainReconciliation,
  dueLogDrainServers,
  getLogDrainExecutionContext,
} from "../../../areas/log-drains/service.js";
export const internalLogDrainRoutes = new Hono();
internalLogDrainRoutes.get("/servers", async (context) =>
  context.json({ servers: await dueLogDrainServers() }),
);
internalLogDrainRoutes.post("/:serverId/health", async (context) => {
  const health = logDrainHealthListSchema.parse(await context.req.json());
  await reportLogDrainHealth(
    z.uuid().parse(context.req.param("serverId")),
    health,
  );
  return context.json({ ok: true });
});
internalLogDrainRoutes.get("/:serverId/context", async (context) => {
  context.header("Cache-Control", "no-store");
  return context.json({
    context: await getLogDrainExecutionContext(
      z.uuid().parse(context.req.param("serverId")),
    ),
  });
});
internalLogDrainRoutes.post("/:serverId/complete", async (context) => {
  await completeLogDrainReconciliation(
    z.uuid().parse(context.req.param("serverId")),
    z
      .object({
        succeeded: z.boolean(),
        health: logDrainHealthListSchema.optional(),
        digest: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
        active: z.boolean().optional(),
        diagnostics: z
          .object({
            otlp: z
              .object({
                active: z.boolean(),
                digest: z.string().regex(/^[a-f0-9]{64}$/u),
                persistentQueue: z.boolean(),
                queueSize: z.number().int().nonnegative(),
                signals: z.array(z.enum(["logs", "metrics", "traces"])).max(3),
                slug: z.string().min(1).max(64).nullable(),
                metrics: z
                  .object({
                    enqueueFailures: z
                      .object({
                        logs: z.number().int().nonnegative(),
                        metrics: z.number().int().nonnegative(),
                        traces: z.number().int().nonnegative(),
                      })
                      .strict(),
                    queueCapacity: z.number().int().nonnegative(),
                    queueDepth: z.number().int().nonnegative(),
                    sendFailures: z
                      .object({
                        logs: z.number().int().nonnegative(),
                        metrics: z.number().int().nonnegative(),
                        traces: z.number().int().nonnegative(),
                      })
                      .strict(),
                  })
                  .strict()
                  .nullable(),
              })
              .strict()
              .optional(),
          })
          .strict()
          .optional(),
        missing: z
          .array(logDrainProviderSchema)
          .max(logDrainProviders.length)
          .optional(),
      })
      .strict()
      .parse(await context.req.json()),
  );
  return context.json({ ok: true });
});
