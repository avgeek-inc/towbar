import { z } from "zod";

export const autoDeployControlPatchSchema = z
  .object({ paused: z.boolean() })
  .strict();
