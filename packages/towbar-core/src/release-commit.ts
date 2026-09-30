import { z } from "zod";

export const releaseCommitSchema = z
  .object({
    composeServices: z
      .array(z.string().trim().min(1).max(255))
      .min(1)
      .max(100)
      .optional(),
    containerName: z.string().trim().min(1).max(255),
    containerNames: z.array(z.string().trim().min(1).max(255)).min(1).max(100),
    imageDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    imagePlatform: z.union([
      z.literal("compose"),
      z
        .string()
        .regex(/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/u)
        .max(64),
    ]),
    imageTag: z.string().trim().min(1).max(255),
  })
  .strict()
  .superRefine((release, context) => {
    if ((release.imagePlatform === "compose") !== !!release.composeServices) {
      context.addIssue({
        code: "custom",
        message:
          "Compose services and platform must describe the same release kind",
        path: ["imagePlatform"],
      });
    }
  });

export type ReleaseCommitPayload = z.infer<typeof releaseCommitSchema>;
