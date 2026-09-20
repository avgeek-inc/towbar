import { createHmac } from "node:crypto";

import type {
  IntegrationTarget,
  NormalizedDeployable,
} from "@workspace/towbar-core";
import { parseCredentialsMasterKey } from "@workspace/towbar-core";
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
  const references = Object.entries(input.deployable.externalSecrets ?? {})
    .filter(([, reference]) => reference.use === input.stage)
    .sort(([left], [right]) => left.localeCompare(right));

  for (const [environmentKey, reference] of references) {
    const resolved = await resolveIntegration({
      workspaceId: input.workspaceId,
      slug: reference.integration,
      providers: ["infisical", "doppler"],
      target: input.target,
    });
    const expected = parseExpectedRevision(
      input.expectedRevisions?.[`external:${environmentKey}`],
    );
    if (
      expected &&
      (expected.integration !== resolved.connection.slug ||
        expected.integrationRevision !== String(resolved.connection.revision))
    )
      throw conflict(
        `External secret connection changed during deployment: ${environmentKey}`,
      );
    const secret = await readExternalSecret(
      resolved.connectionInput,
      reference,
      expected?.secretVersion,
    );
    if (expected && expected.secretVersion !== secret.version)
      throw conflict(
        `External secret version changed during deployment: ${environmentKey}`,
      );
    if (Object.hasOwn(values, environmentKey))
      throw conflict(
        `External secret '${environmentKey}' is declared more than once`,
      );
    values[environmentKey] = selectField(secret.value, reference.field);
    revisions[`external:${environmentKey}`] = [
      resolved.connection.slug,
      resolved.connection.revision,
      secret.version,
    ].join(":");
  }
  return { revisions, values };
}

// eslint-disable-next-line complexity -- Provider dispatch validates and reads each external secret protocol at one fail-closed boundary.
async function readExternalSecret(
  connection: Awaited<ReturnType<typeof resolveIntegration>>["connectionInput"],
  reference: { secret: string; field?: string; version?: string },
  expectedVersion?: string,
) {
  switch (connection.provider) {
    case "doppler": {
      if (reference.version)
        throw unprocessable(
          "Doppler does not expose version-addressed secret reads. Omit version or use a versioned provider.",
        );
      const [project, config, ...nameParts] = reference.secret.split("/");
      const name = nameParts.join("/");
      if (!project || !config || !name)
        throw unprocessable(
          "Doppler secret references use project/config/name",
        );
      const url = new URL("https://api.doppler.com/v3/configs/config/secret");
      url.searchParams.set("project", project);
      url.searchParams.set("config", config);
      url.searchParams.set("name", name);
      const response = await integrationFetch(url.toString(), {
        headers: { Authorization: `Bearer ${connection.credentials.token}` },
      });
      if (!response.ok)
        throw serviceUnavailable("Doppler could not resolve a required secret");
      const result = await readBoundedJson<{
        value?: { raw?: string; computed?: string };
      }>(response, "Doppler");
      const value = result.value?.computed ?? result.value?.raw;
      if (value === undefined)
        throw serviceUnavailable("Doppler returned no secret value");
      assertSecretValueSize(value);
      const version =
        response.headers.get("etag") ?? secretSnapshotFingerprint(value);
      if (expectedVersion && expectedVersion !== version)
        throw conflict("Doppler secret changed during deployment");
      return {
        value,
        version,
      };
    }
    case "infisical": {
      const segments = reference.secret.split("/").filter(Boolean);
      const [projectId, environment, ...pathAndName] = segments;
      const name = pathAndName.pop();
      if (!projectId || !environment || !name)
        throw unprocessable(
          "Infisical secret references use project/environment/path/name",
        );
      const login = await integrationFetch(
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
      if (!login.ok)
        throw serviceUnavailable("Infisical authentication failed");
      const loginResult = await readBoundedJson<{ accessToken?: string }>(
        login,
        "Infisical authentication",
        64 * 1_024,
      );
      if (!loginResult.accessToken)
        throw serviceUnavailable("Infisical returned no access token");
      const url = new URL(
        `/api/v3/secrets/raw/${encodeURIComponent(name)}`,
        connection.configuration.baseUrl,
      );
      url.searchParams.set("workspaceId", projectId);
      url.searchParams.set("environment", environment);
      url.searchParams.set("secretPath", `/${pathAndName.join("/")}`);
      if (reference.version ?? expectedVersion)
        url.searchParams.set("version", reference.version ?? expectedVersion!);
      const response = await integrationFetch(url.toString(), {
        allowPrivateNetwork: connection.configuration.allowPrivateNetwork,
        headers: { Authorization: `Bearer ${loginResult.accessToken}` },
      });
      if (!response.ok)
        throw serviceUnavailable(
          "Infisical could not resolve a required secret",
        );
      const result = await readBoundedJson<{
        secretValue?: string;
        version?: number | string;
      }>(response, "Infisical");
      if (result.secretValue === undefined)
        throw serviceUnavailable("Infisical returned no secret value");
      assertSecretValueSize(result.secretValue);
      return {
        value: result.secretValue,
        version: String(
          result.version ?? reference.version ?? expectedVersion ?? "current",
        ),
      };
    }
    default:
      throw conflict(
        "External secret reference uses an incompatible integration",
      );
  }
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

function selectField(value: string, field?: string) {
  if (!field) return value;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw unprocessable(
      "External secret field selection requires a JSON object",
    );
  }
  let selected = parsed;
  for (const part of field.split(".")) {
    if (
      !selected ||
      typeof selected !== "object" ||
      !Object.hasOwn(selected, part)
    )
      throw unprocessable(
        `External secret JSON field '${field}' was not found`,
      );
    selected = (selected as Record<string, unknown>)[part];
  }
  if (
    typeof selected !== "string" &&
    typeof selected !== "number" &&
    typeof selected !== "boolean"
  )
    throw unprocessable(`External secret JSON field '${field}' is not scalar`);
  return String(selected);
}
