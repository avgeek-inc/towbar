import { z } from "zod";
import {
  deploymentStateSchema,
  environmentNameSchema,
} from "@workspace/towbar-core";

export const historyQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(10),
    environment: z.enum(["production", "preview"]).optional(),
    targetEnvironment: environmentNameSchema.optional(),
    type: z.enum(["app", "resource"]).optional(),
    state: deploymentStateSchema.optional(),
    trigger: z.enum(["auto_deploy", "manual", "rollback"]).optional(),
    serverId: z.uuid().optional(),
    sort: z
      .enum(["newest", "oldest", "name_asc", "name_desc"])
      .default("newest"),
  })
  .strict();
