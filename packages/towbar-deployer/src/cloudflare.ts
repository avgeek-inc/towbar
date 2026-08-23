import { isIP } from "node:net";

import type {
  NormalizedDeployable,
  NormalizedServer,
} from "@workspace/towbar-core";

const cloudflareApiBaseUrl = "https://api.cloudflare.com/client/v4";
const managedCommentPrefix = "Managed by Towbar:";

type CloudflareFetch = typeof fetch;

type CloudflareRecord = {
  comment?: string;
  content: string;
  id: string;
  name: string;
  proxied?: boolean;
  type: string;
};

export async function reconcileCloudflareForDeployment(input: {
  app: NormalizedDeployable;
  credentials: { apiToken: string } | null;
  server: NormalizedServer;
}) {
  if (!input.app.domains || input.app.tls?.mode !== "cloudflare-dns") return;
  if (!input.credentials) {
    throw new Error("Cloudflare DNS credentials were not resolved");
  }
  const domains = [
    input.app.domains.primary,
    ...input.app.domains.redirects.map((redirect) => redirect.host),
  ];
  await verifyCloudflareTlsMode({
    apiToken: input.credentials.apiToken,
    domains,
  });
  await reconcileCloudflareDns({
    apiToken: input.credentials.apiToken,
    allowUnmanagedAdoption: true,
    appId: input.app.id,
    domains,
    serverIp: input.server.ip,
  });
}

export async function reconcileCloudflareDns(input: {
  apiToken: string;
  allowUnmanagedAdoption?: boolean;
  appId: string;
  domains: string[];
  fetcher?: CloudflareFetch;
  serverIp: string;
}) {
  const fetcher = input.fetcher ?? fetch;
  const recordType = isIP(input.serverIp) === 6 ? "AAAA" : "A";
  const zoneCache = new Map<string, string>();
  for (const hostname of new Set(input.domains.map(normalizeHostname))) {
    const zoneId = await findZoneId(
      hostname,
      input.apiToken,
      fetcher,
      zoneCache,
    );
    const records = await cloudflareRequest<CloudflareRecord[]>(
      `/zones/${zoneId}/dns_records?name=${encodeURIComponent(hostname)}&per_page=100`,
      input.apiToken,
      fetcher,
    );
    const conflicting = records.filter(
      (record) =>
        record.type === "A" ||
        record.type === "AAAA" ||
        record.type === "CNAME",
    );
    if (conflicting.length > 1) {
      throw new Error(
        `Cloudflare has multiple address records for '${hostname}'; resolve the conflict before deploying`,
      );
    }

    const existing = conflicting[0];
    const expectedComment = `${managedCommentPrefix} ${input.appId}`;
    const body = {
      comment: expectedComment,
      content: input.serverIp,
      name: hostname,
      proxied: true,
      ttl: 1,
      type: recordType,
    };
    if (!existing) {
      await cloudflareRequest(
        `/zones/${zoneId}/dns_records`,
        input.apiToken,
        fetcher,
        { body, method: "POST" },
      );
      continue;
    }
    if (
      existing.comment?.startsWith(managedCommentPrefix) &&
      existing.comment !== expectedComment
    ) {
      throw new Error(
        `Cloudflare record '${hostname}' is owned by another Towbar app`,
      );
    }
    if (
      existing.comment !== expectedComment &&
      !(
        input.allowUnmanagedAdoption === true &&
        existing.type === recordType &&
        existing.content === input.serverIp
      )
    ) {
      throw new Error(
        `Cloudflare record '${hostname}' is not managed by Towbar for this app`,
      );
    }
    if (
      existing.content !== input.serverIp ||
      existing.proxied !== true ||
      existing.comment !== body.comment
    ) {
      await cloudflareRequest(
        `/zones/${zoneId}/dns_records/${existing.id}`,
        input.apiToken,
        fetcher,
        { body, method: "PUT" },
      );
    }
  }
}

export async function verifyCloudflareTlsMode(input: {
  apiToken: string;
  domains: string[];
  fetcher?: CloudflareFetch;
}) {
  const fetcher = input.fetcher ?? fetch;
  const zoneCache = new Map<string, string>();
  const checkedZones = new Set<string>();
  for (const hostname of new Set(input.domains.map(normalizeHostname))) {
    const zoneId = await findZoneId(
      hostname,
      input.apiToken,
      fetcher,
      zoneCache,
    );
    if (checkedZones.has(zoneId)) continue;
    checkedZones.add(zoneId);
    const setting = await cloudflareRequest<{ value?: string }>(
      `/zones/${zoneId}/settings/ssl`,
      input.apiToken,
      fetcher,
    );
    if (setting.value !== "strict") {
      throw new Error(
        `Cloudflare zone for '${hostname}' must use Full (strict) SSL/TLS mode`,
      );
    }
  }
}

async function findZoneId(
  hostname: string,
  token: string,
  fetcher: CloudflareFetch,
  cache: Map<string, string>,
) {
  const labels = hostname.split(".");
  for (let index = 0; index <= labels.length - 2; index += 1) {
    const candidate = labels.slice(index).join(".");
    const cached = cache.get(candidate);
    if (cached) return cached;
    const zones = await cloudflareRequest<Array<{ id: string; name: string }>>(
      `/zones?name=${encodeURIComponent(candidate)}&status=active&per_page=1`,
      token,
      fetcher,
    );
    const zone = zones.find(
      (value) => normalizeHostname(value.name) === candidate,
    );
    if (zone) {
      cache.set(candidate, zone.id);
      return zone.id;
    }
  }
  throw new Error(`Cloudflare has no active zone for '${hostname}'`);
}

async function cloudflareRequest<T = unknown>(
  path: string,
  token: string,
  fetcher: CloudflareFetch,
  mutation?: { body: unknown; method: "POST" | "PUT" },
) {
  let response: Response;
  try {
    response = await fetcher(`${cloudflareApiBaseUrl}${path}`, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        ...(mutation ? { "content-type": "application/json" } : {}),
      },
      ...(mutation
        ? { body: JSON.stringify(mutation.body), method: mutation.method }
        : {}),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new Error("Cloudflare could not be reached", { cause: error });
  }
  const value = (await response.json().catch(() => null)) as {
    errors?: Array<{ code?: number; message?: string }>;
    result?: T;
    success?: boolean;
  } | null;
  if (!response.ok || !value?.success || value.result === undefined) {
    const code = value?.errors?.[0]?.code;
    throw new Error(
      code
        ? `Cloudflare rejected the DNS change (error ${code})`
        : "Cloudflare rejected the DNS change",
    );
  }
  return value.result;
}

function normalizeHostname(value: string) {
  return value.trim().replace(/\.$/u, "").toLowerCase();
}
