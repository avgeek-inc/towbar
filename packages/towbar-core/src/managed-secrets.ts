import { z } from "zod";

export const secretStages = [
  "build",
  "deployment",
  "pre_deploy",
  "post_deploy",
] as const;
export type SecretStage = (typeof secretStages)[number];
export const secretEnvironmentSchema = z.enum(["production", "preview"]);
export const secretStageSchema = z.enum(secretStages);
export const secretKeySchema = z
  .string()
  .min(1)
  .max(1024)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/u);
export const secretMutationSchema = z
  .object({
    expectedRevision: z.string().uuid().nullable(),
    set: z
      .unknown()
      .refine(
        (value) =>
          !(
            value &&
            typeof value === "object" &&
            Object.hasOwn(value, "__proto__")
          ),
        "The variable name __proto__ is reserved",
      )
      .pipe(
        z.record(
          secretKeySchema,
          z
            .string()
            .max(65_536)
            .refine(
              (value) => !value.includes("\0"),
              "Values cannot contain null bytes",
            ),
        ),
      )
      .default({}),
    delete: z.array(secretKeySchema).max(200).default([]),
  })
  .strict()
  .superRefine((input, context) => {
    const keys = Object.keys(input.set);
    if (keys.length > 200 || (keys.length === 0 && input.delete.length === 0)) {
      context.addIssue({
        code: "custom",
        message: "Change between 1 and 200 keys per request",
      });
    }
    if (
      new Set(input.delete).size !== input.delete.length ||
      input.delete.some((key) => Object.hasOwn(input.set, key))
    ) {
      context.addIssue({
        code: "custom",
        message: "A key can only be changed once per request",
      });
    }
  });
export type SecretMutation = z.infer<typeof secretMutationSchema>;

export function applySecretMutation(
  current: Record<string, string>,
  mutation: Pick<SecretMutation, "set" | "delete">,
) {
  const next: Record<string, string> = Object.assign(
    Object.create(null),
    current,
  );
  for (const key of mutation.delete) delete next[key];
  for (const [key, value] of Object.entries(mutation.set)) next[key] = value;
  return next;
}

export function mergeSecretValues(
  shared: Record<string, string>,
  local: Record<string, string>,
) {
  return { ...shared, ...local };
}
