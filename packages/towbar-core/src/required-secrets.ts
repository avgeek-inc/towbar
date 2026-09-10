import type { RequiredSecrets } from "./manifest-v2.js";

export const requiredSecretStages = {
  build: "build",
  runtime: "deployment",
  preDeploy: "pre_deploy",
  postDeploy: "post_deploy",
} as const;

export function requiredKeysForStage(
  declarations: RequiredSecrets,
  stage: string,
): string[] {
  const entry = Object.entries(requiredSecretStages).find(
    ([, value]) => value === stage,
  );
  return entry ? declarations[entry[0] as keyof RequiredSecrets] : [];
}

export function reconcileDeclaredSecretValues(
  requiredKeys: string[],
  values: Record<string, string>,
) {
  const retained: Record<string, string> = Object.create(null);
  for (const key of requiredKeys) {
    if (Object.hasOwn(values, key)) retained[key] = values[key]!;
  }
  return {
    values: retained,
    keys: [...requiredKeys].sort(),
    missingKeys: requiredKeys
      .filter((key) => !Object.hasOwn(values, key))
      .sort(),
    removedKeys: Object.keys(values)
      .filter((key) => !requiredKeys.includes(key))
      .sort(),
  };
}
