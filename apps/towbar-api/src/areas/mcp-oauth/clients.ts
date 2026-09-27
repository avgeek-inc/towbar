import { z } from "zod";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, fetch as networkFetch } from "undici";
import { eq } from "drizzle-orm";
import { mcpOAuthClients } from "@workspace/towbar-database/schema";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { isPublicProbeAddress } from "../monitoring/http-probe.js";
import {
  OAuthError,
  clientMetadataSchema,
  digest,
  equalSecret,
  secret,
} from "./protocol.js";

export type OAuthClient = {
  id: string;
  name: string;
  redirectUris: string[];
  logo: string | null;
  trust: "metadata-document" | "unverified";
  authMethod: "none" | "client_secret_basic" | "client_secret_post";
  secretHash: string | null;
};
export function metadataDocumentUrl(id: string) {
  const url = new URL(id);
  if (
    id.length > 2048 ||
    url.protocol !== "https:" ||
    url.pathname === "/" ||
    id.includes("#") ||
    url.username ||
    url.password ||
    isIP(url.hostname.replace(/^\[|\]$/g, ""))
  )
    throw new OAuthError(
      "invalid_client",
      "Client metadata must use a public HTTPS document URL",
    );
  return url;
}
export function clientLogo(hostname: string) {
  if (
    ["openai.com", "chatgpt.com"].some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
    )
  )
    return "openai";
  if (hostname === "claude.ai" || hostname.endsWith(".claude.ai"))
    return "claude";
  if (hostname === "cursor.com" || hostname.endsWith(".cursor.com"))
    return "cursor";
  if (hostname === "code.visualstudio.com") return "vscode";
  return null;
}
export async function fetchClientDocument(id: string) {
  const url = metadataDocumentUrl(id);
  const addresses = await lookup(url.hostname, { all: true });
  if (
    !addresses.length ||
    addresses.some(({ address }) => !isPublicProbeAddress(address))
  )
    throw new OAuthError(
      "invalid_client",
      "Client metadata must be hosted on a public network",
    );
  // Pin the validated DNS answers for this request, including connection retries.
  const dispatcher = new Agent({
    connect: {
      lookup: (_hostname, options, callback) => {
        const first = addresses[0]!;
        if (options.all) callback(null, addresses);
        else callback(null, first.address, first.family);
      },
    },
  });
  try {
    const response = await networkFetch(url, {
      dispatcher,
      redirect: "error",
      signal: AbortSignal.timeout(5000),
      headers: { accept: "application/json" },
    });
    if (
      !response.ok ||
      !response.headers.get("content-type")?.includes("application/json")
    )
      throw new OAuthError(
        "invalid_client",
        "Client metadata could not be read",
      );
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of response.body!) {
      size += chunk.length;
      if (size > 32768)
        throw new OAuthError("invalid_client", "Client metadata is too large");
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } finally {
    await dispatcher.close();
  }
}
export function parseClientDocument(id: string, value: unknown): OAuthClient {
  const url = metadataDocumentUrl(id);
  const parsed = clientMetadataSchema
    .extend({
      client_id: z.string().url().max(2048),
      client_name: clientMetadataSchema.shape.client_name.removeDefault(),
      token_endpoint_auth_method:
        clientMetadataSchema.shape.token_endpoint_auth_method
          .removeDefault()
          .default("none"),
    })
    .safeParse(value);
  if (
    !parsed.success ||
    parsed.data.client_id !== id ||
    parsed.data.token_endpoint_auth_method !== "none"
  )
    throw new OAuthError(
      "invalid_client",
      "Invalid client metadata; metadata clients must use PKCE without a client secret",
    );
  return {
    id,
    name: parsed.data.client_name,
    redirectUris: parsed.data.redirect_uris,
    authMethod: "none",
    secretHash: null,
    trust: "metadata-document",
    logo: clientLogo(url.hostname),
  };
}
export async function resolveClient(id: string): Promise<OAuthClient> {
  if (id.startsWith("https://")) {
    try {
      return parseClientDocument(id, await fetchClientDocument(id));
    } catch (error) {
      if (error instanceof OAuthError) throw error;
      throw new OAuthError(
        "invalid_client",
        "Client metadata could not be loaded",
      );
    }
  }
  const [stored] = await getTowbarDatabase()
    .select()
    .from(mcpOAuthClients)
    .where(eq(mcpOAuthClients.id, id));
  if (!stored) throw new OAuthError("invalid_client", "Unknown client");
  return { ...stored, trust: "unverified", logo: null };
}
export async function registerClient(body: unknown) {
  const parsed = clientMetadataSchema.safeParse(body);
  if (!parsed.success)
    throw new OAuthError(
      "invalid_client_metadata",
      "Use authorization_code, code responses, and HTTPS or loopback redirect URIs",
    );
  const metadata = parsed.data,
    id = secret();
  const clientSecret =
    metadata.token_endpoint_auth_method === "none" ? null : secret();
  await getTowbarDatabase()
    .insert(mcpOAuthClients)
    .values({
      id,
      name: metadata.client_name,
      redirectUris: metadata.redirect_uris,
      authMethod: metadata.token_endpoint_auth_method,
      secretHash: clientSecret ? digest(clientSecret) : null,
    });
  return {
    ...metadata,
    grant_types: ["authorization_code"],
    client_id: id,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    ...(clientSecret
      ? { client_secret: clientSecret, client_secret_expires_at: 0 }
      : {}),
  };
}
export async function authenticateClient(
  params: Record<string, string>,
  authorization?: string,
) {
  let id = params.client_id,
    supplied = params.client_secret,
    method = supplied ? "client_secret_post" : "none";
  if (authorization) {
    if (supplied || !authorization.startsWith("Basic "))
      throw new OAuthError(
        "invalid_client",
        "Invalid client authentication",
        401,
      );
    const decoded = Buffer.from(authorization.slice(6), "base64").toString(
        "utf8",
      ),
      colon = decoded.indexOf(":");
    if (colon < 0)
      throw new OAuthError(
        "invalid_client",
        "Invalid client authentication",
        401,
      );
    const basicId = decodeClientCredential(decoded.slice(0, colon));
    if (id && id !== basicId)
      throw new OAuthError("invalid_client", "Client IDs do not match", 401);
    id = basicId;
    supplied = decodeClientCredential(decoded.slice(colon + 1));
    method = "client_secret_basic";
  }
  if (!id)
    throw new OAuthError("invalid_client", "A client ID is required", 401);
  const client = await resolveClient(id);
  if (
    client.authMethod !== method ||
    (client.secretHash &&
      (!supplied || !equalSecret(digest(supplied), client.secretHash)))
  )
    throw new OAuthError(
      "invalid_client",
      "Invalid client authentication",
      401,
    );
  return client;
}

function decodeClientCredential(value: string) {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    throw new OAuthError(
      "invalid_client",
      "Invalid client authentication",
      401,
    );
  }
}
