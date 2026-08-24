import { z } from "zod";

const environmentKeySchema = z
  .string()
  .min(1)
  .max(1_024)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/u);

export const secretReferenceSchema = z
  .object({ reference: z.string().trim().min(1).max(1_024) })
  .strict();

export const secretMutationSchema = z
  .object({
    delete: z.array(environmentKeySchema).max(200).default([]),
    expectedVersionId: z.string().min(1).max(256),
    reference: z.string().trim().min(1).max(1_024),
    set: z.record(environmentKeySchema, z.string().max(65_536)).default({}),
  })
  .strict()
  .superRefine((input, context) => {
    if (Object.keys(input.set).length > 200) {
      context.addIssue({
        code: "custom",
        message: "A secret mutation cannot set more than 200 keys",
        path: ["set"],
      });
    }
    if (input.delete.length === 0 && Object.keys(input.set).length === 0) {
      context.addIssue({
        code: "custom",
        message: "At least one secret key change is required",
      });
    }
    if (new Set(input.delete).size !== input.delete.length) {
      context.addIssue({
        code: "custom",
        message: "Secret keys to delete must be unique",
        path: ["delete"],
      });
    }
    for (const key of input.delete) {
      if (Object.hasOwn(input.set, key)) {
        context.addIssue({
          code: "custom",
          message: `Secret key '${key}' cannot be replaced and deleted together`,
        });
      }
    }
  });
