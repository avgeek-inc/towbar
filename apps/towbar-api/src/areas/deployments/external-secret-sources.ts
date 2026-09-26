import { createHmac } from "node:crypto";

import type {
  IntegrationTarget,
  NormalizedDeployable,
} from "@workspace/towbar-core";
import {
  externalSecretsSchema,
  parseCredentialsMasterKey,
} from "@workspace/towbar-core";
import { getEnv } from "../../env.js";
import {
  conflict,
  serviceUnavailable,
  unprocessable,
} from "../../http/errors.js";
import { integrationFetch } from "../../infrastructure/outbound-network.js";
import { resolveIntegration } from "../integrations/service.js";

const maxExternalSecretResponseBytes = 256 * 1_024;
const maxExternalSecretValueBytes = 64 * 1_024;

export async function resolveExternalSecretSnapshot(input: {
  deployable: NormalizedDeployable;
  expectedRevisions?: Record<string, string | null> | null;
  stage: "build" | "runtime";
  target: Extract<IntegrationTarget, { kind: "repository" }>;
  workspaceId: string;
}) {
  const values: Record<string, string> = {};
  const revisions: Record<string, string> = {};
  const source = input.deployable.externalSecrets;
  if (!source) return { revisions, values };
  if (!externalSecretsSchema.safeParse(source).success)
    throw unprocessable(
      "Stored external secret source is unsupported; sync the repository with the current manifest format",
    );
  if (input.stage === "build") return { revisions, values };
  return resolveExternalSecretSource(input);
}

async function resolveExternalSecretSource(input: {
  deployable: NormalizedDeployable;
  expectedRevisions?: Record<string, string | null> | null;
  stage: "build" | "runtime";
  target: Extract<IntegrationTarget, { kind: "repository" }>;
  workspaceId: string;
}) {
  const source = input.deployable.externalSecrets;
  if (!source) throw conflict("External secret source is missing");
  const resolved = await resolveIntegration({
    workspaceId: input.workspaceId,
    slug: source.integration,
    providers: ["infisical", "doppler"],
    target: input.target,
  });
  const connection = resolved.connectionInput;
  let secrets: Array<{
    name: string;
    value: string;
    version?: number | string;
  }>;
  if (
    source.integration === "infisical" &&
    connection.provider === "infisical"
  ) {
    secrets = await readInfisicalSecretFolder(connection, source);
  } else if (
    source.integration === "doppler" &&
    connection.provider === "doppler"
  ) {
    secrets = await readDopplerConfig(connection, source);
  } else {
    throw conflict("External secret source uses an incompatible integration");
  }
  if (secrets.length === 0)
    throw serviceUnavailable("External secret source is empty or unavailable");
  if (secrets.length > 200)
    throw serviceUnavailable("External secret source exceeds 200 secrets");
  const values: Record<string, string> = {};
  const revisions: Record<string, string> = {};
  for (const secret of secrets) {
    const { name, value } = secret;
    if (
      !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name) ||
      ["__proto__", "prototype", "constructor"].includes(name)
    )
      throw serviceUnavailable(
        "External secret source returned an invalid environment variable name",
      );
    if (Object.hasOwn(values, name))
      throw serviceUnavailable(
        "External secret source returned duplicate secret names",
      );
    assertSecretValueSize(value);
    const expected = parseExpectedRevision(
      input.expectedRevisions?.[`external:${name}`],
    );
    const version = String(secret.version ?? secretSnapshotFingerprint(value));
    if (
      expected &&
      (expected.integration !== resolved.connection.slug ||
        expected.integrationRevision !== String(resolved.connection.revision) ||
        expected.secretVersion !== version)
    )
      throw conflict(`External secret changed during deployment: ${name}`);
    values[name] = value;
    revisions[`external:${name}`] = [
      resolved.connection.slug,
      resolved.connection.revision,
      version,
    ].join(":");
  }
  for (const key of Object.keys(input.expectedRevisions ?? {})) {
    if (key.startsWith("external:") && !Object.hasOwn(revisions, key))
      throw conflict(
        `External secret disappeared during deployment: ${key.slice(9)}`,
      );
  }
  return { revisions, values };
}

async function readInfisicalSecretFolder(
  connection: Extract<
    Awaited<ReturnType<typeof resolveIntegration>>["connectionInput"],
    { provider: "infisical" }
  >,
  source: { project: string; environmentSlug?: string; secretPath?: string },
) {
  const token = await infisicalAccessToken(connection);
  const url = new URL("/api/v3/secrets/raw", connection.configuration.baseUrl);
  url.searchParams.set("workspaceId", source.project);
  url.searchParams.set("environment", source.environmentSlug ?? "prod");
  url.searchParams.set(
    "secretPath",
    source.secretPath
      ? `/${source.secretPath.replace(/^\/+|\/+$/gu, "")}`
      : "/",
  );
  url.searchParams.set("recursive", "false");
  url.searchParams.set("include_imports", "false");
  const response = await integrationFetch(url.toString(), {
    allowPrivateNetwork: connection.configuration.allowPrivateNetwork,
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok)
    throw serviceUnavailable("Infisical could not resolve the secret folder");
  const result = await readBoundedJson<{
    secrets?: Array<{
      secretKey?: string;
      secretValue?: string;
      version?: number | string;
    }>;
  }>(response, "Infisical", 1024 * 1024);
  if (!Array.isArray(result.secrets))
    throw serviceUnavailable("Infisical returned an invalid secret list");
  return result.secrets.map((secret) => {
    if (
      typeof secret.secretKey !== "string" ||
      typeof secret.secretValue !== "string"
    )
      throw serviceUnavailable("Infisical returned an invalid secret");
    return {
      name: secret.secretKey,
      value: secret.secretValue,
      version: secret.version,
    };
  });
}

async function readDopplerConfig(
  connection: Extract<
    Awaited<ReturnType<typeof resolveIntegration>>["connectionInput"],
    { provider: "doppler" }
  >,
  source: { project: string; config?: string },
) {
  const url = new URL(
    "https://api.doppler.com/v3/configs/config/secrets/download",
  );
  url.searchParams.set("format", "json");
  url.searchParams.set("project", source.project);
  if (source.config) url.searchParams.set("config", source.config);
  url.searchParams.set("include_dynamic_secrets", "false");
  const response = await integrationFetch(url.toString(), {
    headers: { Authorization: `Bearer ${connection.credentials.token}` },
  });
  if (!response.ok)
    throw serviceUnavailable("Doppler could not resolve the secret config");
  const result = await readBoundedJson<unknown>(
    response,
    "Doppler",
    1024 * 1024,
  );
  if (!result || typeof result !== "object" || Array.isArray(result))
    throw serviceUnavailable("Doppler returned an invalid secret list");
  return Object.entries(result).map(([name, value]) => {
    if (typeof value !== "string")
      throw serviceUnavailable("Doppler returned an invalid secret value");
    return { name, value };
  });
}

async function infisicalAccessToken(
  connection: Extract<
    Awaited<ReturnType<typeof resolveIntegration>>["connectionInput"],
    { provider: "infisical" }
  >,
) {
  const response = await integrationFetch(
    new URL(
      "/api/v1/auth/universal-auth/login",
      connection.configuration.baseUrl,
    ).toString(),
    {
      allowPrivateNetwork: connection.configuration.allowPrivateNetwork,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(connection.credentials),
    },
  );
  if (!response.ok) throw serviceUnavailable("Infisical authentication failed");
  const result = await readBoundedJson<{ accessToken?: string }>(
    response,
    "Infisical authentication",
    64 * 1_024,
  );
  if (!result.accessToken)
    throw serviceUnavailable("Infisical returned no access token");
  return result.accessToken;
}

async function readBoundedJson<T>(
  response: Response,
  provider: string,
  limit = maxExternalSecretResponseBytes,
) {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > limit)
    throw serviceUnavailable(`${provider} returned an oversized response`);
  if (!response.body)
    throw serviceUnavailable(`${provider} returned an empty response`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit)
        throw serviceUnavailable(`${provider} returned an oversized response`);
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  try {
    return JSON.parse(Buffer.concat(chunks, length).toString("utf8")) as T;
  } catch {
    throw serviceUnavailable(`${provider} returned an invalid response`);
  }
}

function assertSecretValueSize(value: string) {
  if (Buffer.byteLength(value, "utf8") > maxExternalSecretValueBytes)
    throw serviceUnavailable("External secret value exceeds 64 KiB");
}

function secretSnapshotFingerprint(value: string) {
  return `hmac-sha256:${createHmac(
    "sha256",
    parseCredentialsMasterKey(getEnv().TOWBAR_CREDENTIALS_KEY),
  )
    .update(value, "utf8")
    .digest("base64url")}`;
}

function parseExpectedRevision(value: string | null | undefined) {
  if (!value) return null;
  const [integration, integrationRevision, ...versionParts] = value.split(":");
  const secretVersion = versionParts.join(":");
  if (
    !integration ||
    !/^\d+$/u.test(integrationRevision ?? "") ||
    !secretVersion
  )
    throw conflict("Stored external secret revision is invalid");
  return { integration, integrationRevision, secretVersion };
}
