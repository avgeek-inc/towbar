import path from "node:path";

import { z } from "zod";

export const deploymentInputGroupPattern =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export const deploymentInputPatternSchema = z
  .string()
  .trim()
  .min(1)
  .max(1_024)
  .superRefine((value, context) => {
    if (value.startsWith("$")) {
      if (!deploymentInputGroupPattern.test(value.slice(1))) {
        context.addIssue({
          code: "custom",
          message:
            "Expected a deployment input group reference such as $shared-web",
        });
      }
      return;
    }
    if (
      value.startsWith("!") ||
      value.includes("\\") ||
      value.includes("\0") ||
      path.posix.isAbsolute(value)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Deployment input patterns must be relative, additive repository globs",
      });
      return;
    }
    if (value.split("/").includes("..")) {
      context.addIssue({
        code: "custom",
        message: "Deployment input patterns cannot contain parent segments",
      });
    }
  });

export const deploymentInputGlobSchema = deploymentInputPatternSchema.refine(
  (value) => !value.startsWith("$"),
  "Root deployment input groups must contain repository globs, not group references",
);

export const autoDeploySchema = z.union([
  z.boolean(),
  z
    .object({
      inputs: z.array(deploymentInputPatternSchema).min(1).max(200),
    })
    .strict(),
]);
