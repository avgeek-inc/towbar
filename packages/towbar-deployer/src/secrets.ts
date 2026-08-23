import type { DeploymentSecrets } from "./types.js";

const environmentKeyPattern = /^[A-Za-z_][A-Za-z0-9_]*$/u;
export const aggregateBuildSecretKey = "GOD_BUILD_ENV_JSON";

export function validateDeploymentSecrets(secrets: DeploymentSecrets) {
  for (const [key, value] of Object.entries({
    ...secrets.build,
    ...secrets.hooks.postDeploy,
    ...secrets.hooks.preDeploy,
    ...secrets.runtime,
  })) {
    if (!environmentKeyPattern.test(key)) {
      throw new Error("Secret bundle contains an invalid environment key");
    }
    if (value.includes("\0")) {
      throw new Error(`Secret '${key}' contains a null byte`);
    }
  }
  if (Object.hasOwn(secrets.build, aggregateBuildSecretKey)) {
    throw new Error(
      `${aggregateBuildSecretKey} is reserved for Towbar's aggregate build secret`,
    );
  }
}

export function collectSensitiveValues(secrets: DeploymentSecrets) {
  return [
    secrets.login.privateKey,
    secrets.cloudflare?.apiToken,
    ...Object.values(secrets.build),
    ...Object.values(secrets.hooks.postDeploy),
    ...Object.values(secrets.hooks.preDeploy),
    ...Object.values(secrets.runtime),
  ].filter((value): value is string => Boolean(value));
}

export function redactSensitiveValues(content: string, values: string[]) {
  let redacted = content;
  for (const value of values) {
    if (value) redacted = redacted.replaceAll(value, "[REDACTED]");
  }
  return redacted;
}
