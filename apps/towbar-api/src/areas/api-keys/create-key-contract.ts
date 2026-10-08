import { z } from "zod";

export const createKeySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    access: z.enum(["read", "edit"]),
    includeAdmin: z.boolean(),
    expiresAt: z.iso.datetime().nullable(),
  })
  .strict()
  .refine((value) => !value.includeAdmin || value.access === "edit", {
    message: "Administrative permissions require edit access",
    path: ["includeAdmin"],
  });
