import { digestValue } from "@workspace/towbar-core";
import type {
  NormalizedApp,
  resolveRepositoryEnvironment,
} from "@workspace/towbar-core";

type ResolvedEnvironment = ReturnType<typeof resolveRepositoryEnvironment>;

export function resolvePreviewConfiguration(input: {
  resolved: ResolvedEnvironment;
  target: NormalizedApp;
}) {
  const app = input.resolved.manifest.apps.find(
    (item) => item.id === input.target.id,
  );
  if (!input.target.preview?.enabled || !app?.preview?.enabled) return null;
  // PR code uses the connected environment's infrastructure and preview domain.
  const config: NormalizedApp = {
    ...app,
    server: input.target.server,
    preview: input.target.preview,
  };
  return {
    config,
    requiredSecrets: input.resolved.manifest.requiredSecrets[`app:${app.id}`]!,
    manifestDigest: digestValue({ manifest: input.resolved.digest, config }),
  };
}
