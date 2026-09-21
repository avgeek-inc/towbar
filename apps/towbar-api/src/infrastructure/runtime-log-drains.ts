import {
  type LogDrainCredential,
  type LogDrainProvider,
  digestValue,
  logDrainCredentialSchema,
  logDrainProviders,
} from "@workspace/towbar-core";

type RuntimeLogDrain = {
  credential: LogDrainCredential;
  provider: LogDrainProvider;
  revision: string;
};

let cached: RuntimeLogDrain[] | undefined;

export function getRuntimeLogDrains(
  environment: Record<string, string | undefined> = process.env,
) {
  if (environment === process.env && cached) return cached;
  const result = logDrainProviders.flatMap((provider) => {
    const prefix = `TOWBAR_LOG_DRAIN_${provider.toUpperCase()}`;
    const enabled = environment[`${prefix}_ENABLED`]?.trim();
    if (!enabled || enabled === "false") return [];
    if (enabled !== "true")
      throw new Error(`${prefix}_ENABLED must be true or false`);
    const raw = environment[`${prefix}_CONFIG_JSON`]?.trim();
    if (!raw)
      throw new Error(
        `${prefix}_CONFIG_JSON is required when ${prefix}_ENABLED=true`,
      );
    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch (error) {
      throw new Error(`${prefix}_CONFIG_JSON must contain valid JSON`, {
        cause: error,
      });
    }
    const credential = logDrainCredentialSchema.parse({
      ...(decoded as object),
      provider,
    });
    return [{ credential, provider, revision: digestValue(raw) }];
  });
  if (environment === process.env) cached = result;
  return result;
}
