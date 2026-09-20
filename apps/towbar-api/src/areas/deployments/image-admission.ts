import { createHash } from "node:crypto";

import {
  type NormalizedApp,
  isNormalizedCompose,
  isNormalizedResource,
} from "@workspace/towbar-core";

import { unprocessable } from "../../http/errors.js";
import { integrationFetch } from "../../infrastructure/outbound-network.js";
import { resolveIntegration } from "../integrations/service.js";

const manifestAccept = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");
const digestPattern = /^sha256:[a-f0-9]{64}$/u;

type RegistryCredential = {
  allowPrivateNetwork: boolean;
  password: string;
  registry: string;
  username: string;
};

type ParsedReference = {
  apiHost: string;
  canonicalRegistry: string;
  repository: string;
  selector: string;
};

export async function admitApplicationImage(input: {
  deployable: import("@workspace/towbar-core").NormalizedDeployable;
  environment: string;
  sourceId: string;
  workspaceId: string;
}) {
  if (
    isNormalizedResource(input.deployable) ||
    isNormalizedCompose(input.deployable) ||
    input.deployable.deployment?.type !== "image"
  ) {
    return {
      imageDigest: null,
      imageSourceReference: null,
      snapshot: input.deployable,
    };
  }
  const deployment = input.deployable.deployment;
  const sourceReference = deployment.image;
  const reference = parseReference(sourceReference);
  const credential = deployment.registry
    ? await registryCredential({
        environment: input.environment,
        slug: deployment.registry,
        sourceId: input.sourceId,
        workspaceId: input.workspaceId,
      })
    : null;
  if (credential) assertRegistryMatches(reference, credential.registry);
  if (reference.selector.startsWith("sha256:")) {
    return {
      imageDigest: reference.selector,
      imageSourceReference: sourceReference,
      snapshot: input.deployable,
    };
  }
  const digest = await resolveManifestDigest(reference, credential);
  const image = `${reference.canonicalRegistry}/${reference.repository}@${digest}`;
  const snapshot: NormalizedApp = {
    ...input.deployable,
    deployment: { ...deployment, image },
  };
  return {
    imageDigest: digest,
    imageSourceReference: sourceReference,
    snapshot,
  };
}

function parseReference(value: string): ParsedReference {
  if (value.includes("://") || /[\\?#]/u.test(value))
    throw unprocessable("The application image reference is invalid");
  const digest = /@(?<digest>sha256:[a-f0-9]{64})$/u.exec(value)?.groups
    ?.digest;
  const referenceName = digest ? value.slice(0, -(digest.length + 1)) : value;
  const separator = referenceName.lastIndexOf(":");
  const slash = referenceName.lastIndexOf("/");
  if (!digest && (separator <= slash || separator === referenceName.length - 1))
    throw unprocessable("The application image must use an explicit tag");
  const name = digest ? referenceName : referenceName.slice(0, separator);
  const selector = digest ?? referenceName.slice(separator + 1);
  if (selector === "latest")
    throw unprocessable("The application image cannot use the latest tag");
  if (!digest && !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/u.test(selector))
    throw unprocessable("The application image tag is invalid");
  const parts = name.split("/");
  const first = parts[0]!;
  const hasRegistry =
    first.includes(".") || first.includes(":") || first === "localhost";
  const registry = hasRegistry ? first : "docker.io";
  const repositoryParts = hasRegistry ? parts.slice(1) : parts;
  if (
    !repositoryParts.length ||
    repositoryParts.some(
      (part) => !/^[a-z0-9]+(?:(?:[._]|__|[-]+)[a-z0-9]+)*$/u.test(part),
    )
  )
    throw unprocessable("The application image repository is missing");
  if (registry === "docker.io" && repositoryParts.length === 1)
    repositoryParts.unshift("library");
  return {
    apiHost: registry === "docker.io" ? "registry-1.docker.io" : registry,
    canonicalRegistry: registry,
    repository: repositoryParts.join("/"),
    selector,
  };
}

async function registryCredential(input: {
  environment: string;
  slug: string;
  sourceId: string;
  workspaceId: string;
}): Promise<RegistryCredential> {
  const resolved = await resolveIntegration({
    workspaceId: input.workspaceId,
    slug: input.slug,
    providers: ["registry"],
    target: {
      kind: "repository",
      purpose: "image",
      repositoryId: input.sourceId,
      environment: input.environment,
    },
  });
  if (resolved.connectionInput.provider !== "registry")
    throw new Error("Registry integration resolved an incompatible provider");
  return {
    allowPrivateNetwork:
      resolved.connectionInput.configuration.allowPrivateNetwork,
    registry: resolved.connectionInput.configuration.registry,
    username: resolved.connectionInput.credentials.username,
    password: resolved.connectionInput.credentials.password,
  };
}

function assertRegistryMatches(reference: ParsedReference, configured: string) {
  const url = configured.includes("://")
    ? new URL(configured)
    : new URL(`https://${configured}`);
  const configuredHost = url.host.toLowerCase();
  const expected = new Set([
    reference.canonicalRegistry.toLowerCase(),
    reference.apiHost.toLowerCase(),
  ]);
  if (!expected.has(configuredHost))
    throw unprocessable(
      "The selected registry integration does not match the application image registry",
    );
}

async function resolveManifestDigest(
  reference: ParsedReference,
  credential: RegistryCredential | null,
) {
  const url = `https://${reference.apiHost}/v2/${reference.repository}/manifests/${encodeURIComponent(reference.selector)}`;
  const basic = credential
    ? `Basic ${Buffer.from(`${credential.username}:${credential.password}`).toString("base64")}`
    : null;
  let response = await manifestRequest(url, credential, basic);
  if (response.status === 401) {
    const challenge = response.headers.get("www-authenticate");
    await response.body?.cancel();
    const token = await registryBearerToken(
      challenge,
      reference,
      credential,
      basic,
    );
    response = await manifestRequest(url, credential, `Bearer ${token}`);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw unprocessable(
      response.status === 401 || response.status === 403
        ? "The registry rejected the configured credentials"
        : `The registry could not resolve this image tag (status ${response.status})`,
    );
  }
  const declared = response.headers.get("docker-content-digest");
  if (declared && digestPattern.test(declared)) {
    await response.body?.cancel();
    return declared;
  }
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > 4 * 1_024 * 1_024) {
    await response.body?.cancel();
    throw unprocessable("The registry manifest is too large");
  }
  const bytes = await readBoundedBody(response, 4 * 1_024 * 1_024, "manifest");
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function manifestRequest(
  url: string,
  credential: RegistryCredential | null,
  authorization: string | null,
) {
  try {
    return await integrationFetch(url, {
      allowPrivateNetwork: credential?.allowPrivateNetwork,
      headers: {
        Accept: manifestAccept,
        ...(authorization ? { Authorization: authorization } : {}),
      },
    });
  } catch {
    throw unprocessable("The image registry could not be reached");
  }
}

async function registryBearerToken(
  raw: string | null,
  reference: ParsedReference,
  credential: RegistryCredential | null,
  basic: string | null,
) {
  if (!raw?.toLowerCase().startsWith("bearer "))
    throw unprocessable(
      "The registry returned an unsupported authentication challenge",
    );
  const fields = Object.fromEntries(
    [...raw.slice(7).matchAll(/([A-Za-z]+)="([^"]*)"/gu)].map((match) => [
      match[1]!.toLowerCase(),
      match[2]!,
    ]),
  );
  if (!fields.realm)
    throw unprocessable("The registry authentication challenge is incomplete");
  const tokenUrl = new URL(fields.realm);
  tokenUrl.searchParams.set("service", fields.service ?? reference.apiHost);
  tokenUrl.searchParams.set("scope", `repository:${reference.repository}:pull`);
  let response: Response;
  try {
    response = await integrationFetch(tokenUrl.toString(), {
      allowPrivateNetwork: credential?.allowPrivateNetwork,
      headers: basic ? { Authorization: basic } : {},
    });
  } catch {
    throw unprocessable(
      "The registry authentication service could not be reached",
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw unprocessable("The registry rejected the configured credentials");
  }
  const text = (
    await readBoundedBody(response, 64 * 1_024, "authentication response")
  ).toString("utf8");
  let payload: { token?: string; access_token?: string };
  try {
    payload = JSON.parse(text) as typeof payload;
  } catch {
    throw unprocessable("The registry authentication response is invalid");
  }
  const token = payload.token ?? payload.access_token;
  if (!token || token.length > 16_384)
    throw unprocessable("The registry authentication response is incomplete");
  return token;
}

async function readBoundedBody(
  response: Response,
  maximumBytes: number,
  label: string,
) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maximumBytes)
        throw unprocessable(`The registry ${label} is too large`);
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return Buffer.concat(chunks, received);
}
