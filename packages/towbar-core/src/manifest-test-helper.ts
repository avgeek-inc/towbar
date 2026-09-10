import { parseDocument } from "yaml";
import {
  ManifestValidationError,
  digestValue,
  normalizeDeploymentManifest,
  resolvedDeploymentManifestSchema,
} from "./manifest.js";
const MAX_MANIFEST_BYTES = 256 * 1_024;

export function parseResolvedManifest(source: string) {
  if (Buffer.byteLength(source, "utf8") > MAX_MANIFEST_BYTES) {
    throw new ManifestValidationError([
      {
        message: `Manifest exceeds the ${MAX_MANIFEST_BYTES}-byte limit`,
        path: [],
      },
    ]);
  }

  const document = parseDocument(source, {
    prettyErrors: false,
    strict: true,
    uniqueKeys: true,
  });
  if (document.errors.length > 0) {
    throw new ManifestValidationError(
      document.errors.map((error) => ({
        ...(error.linePos?.[0]
          ? {
              column: error.linePos[0].col,
              line: error.linePos[0].line,
            }
          : {}),
        message: error.message,
        path: [],
      })),
    );
  }

  let value: unknown;
  try {
    value = document.toJS({ maxAliasCount: 0 });
  } catch (error) {
    throw new ManifestValidationError([
      {
        message:
          error instanceof Error ? error.message : "Unable to decode YAML",
        path: [],
      },
    ]);
  }

  const result = resolvedDeploymentManifestSchema.safeParse(value);
  if (!result.success) {
    throw new ManifestValidationError(
      result.error.issues.map((issue) => ({
        message: issue.message,
        path: issue.path.map((part) =>
          typeof part === "symbol" ? (part.description ?? "symbol") : part,
        ),
      })),
    );
  }

  const manifest = normalizeDeploymentManifest(result.data);
  return {
    digest: digestValue(manifest),
    manifest,
  };
}
