import { z } from "zod";
import type { RepositoryTree } from "./repository-tree.js";

export const configurationFileSchema = z
  .object({
    source: z
      .string()
      .min(1)
      .max(1_024)
      .refine(
        (value) =>
          /^[A-Za-z0-9_./-]+$/.test(value) &&
          !value.startsWith("/") &&
          value
            .split("/")
            .every((part) => part && part !== "." && part !== ".."),
        "Use a canonical repository-relative file path without traversal",
      ),
    mountPath: z
      .string()
      .min(2)
      .max(1_024)
      .refine(
        (value) =>
          /^\/[A-Za-z0-9_./-]+$/.test(value) &&
          value
            .split("/")
            .slice(1)
            .every((part) => part && part !== "." && part !== "..") &&
          !["/proc", "/sys", "/dev", "/run", "/var/run"].some(
            (root) => value === root || value.startsWith(`${root}/`),
          ),
        "Use an absolute file path outside container runtime and device directories",
      ),
    mode: z.enum(["0444", "0555"]).optional(),
  })
  .strict();

export type ConfigurationFile = z.infer<typeof configurationFileSchema>;

export function validateConfigurationMounts(
  container: {
    configFiles?: ConfigurationFile[];
    volumes?: { mountPath: string }[];
  },
  context: z.RefinementCtx,
) {
  const files = container.configFiles ?? [];
  for (const [index, file] of files.entries()) {
    if (
      files
        .slice(0, index)
        .some((other) => overlaps(file.mountPath, other.mountPath)) ||
      container.volumes?.some(
        (volume) =>
          volume.mountPath === file.mountPath ||
          volume.mountPath.startsWith(`${file.mountPath}/`),
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["container", "configFiles", index, "mountPath"],
        message:
          "Configuration file targets cannot overlap each other or cover a volume",
      });
    }
  }
}

function overlaps(a: string, b: string) {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

export function validateConfigurationSources(
  files: ConfigurationFile[],
  tree: RepositoryTree,
) {
  if (!files.length) return;
  if (!tree.complete)
    throw new Error(
      "A complete repository tree is required for configuration files",
    );
  const entries = new Map(tree.entries.map((entry) => [entry.path, entry]));
  for (const file of files) {
    const entry = entries.get(file.source);
    if (
      !entry ||
      entry.type !== "blob" ||
      !["100644", "100755"].includes(entry.mode)
    )
      throw new Error(
        `Configuration source '${file.source}' must be a regular repository file`,
      );
    const parts = file.source.split("/");
    for (let count = 1; count < parts.length; count++) {
      if (entries.has(parts.slice(0, count).join("/")))
        throw new Error(
          `Configuration source '${file.source}' traverses a non-directory`,
        );
    }
  }
}
