import { lookup } from "node:dns/promises";
import { Agent, fetch as networkFetch } from "undici";
import {
  assertNetworkAddressAllowed,
  createPolicyLookup,
} from "@workspace/towbar-core/network-policy";
import { unprocessable } from "../http/errors.js";

const publicNetworkAgent = new Agent({
  connect: { lookup: createPolicyLookup(false) },
});
const privateNetworkAgent = new Agent({
  connect: { lookup: createPolicyLookup(true) },
});

const alwaysBlockedHosts = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.google.internal.",
]);

/**
 * Rejects endpoints that can reach this control plane or a cloud metadata
 * service. Private RFC1918/ULA endpoints require the explicit connection flag;
 * loopback and link-local ranges are never accepted.
 */
async function assertSafeOutboundUrl(
  raw: string,
  options: { allowPrivateNetwork?: boolean } = {},
) {
  const url = new URL(raw);
  if (url.protocol !== "https:")
    throw unprocessable("Integration endpoints must use HTTPS");
  const hostname = url.hostname.toLowerCase();
  if (alwaysBlockedHosts.has(hostname))
    throw unprocessable("This integration endpoint is not allowed");
  let addresses: { address: string; family: number }[];
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw unprocessable("The integration endpoint could not be resolved");
  }
  if (!addresses.length)
    throw unprocessable("The integration endpoint could not be resolved");
  for (const entry of addresses) {
    try {
      assertNetworkAddressAllowed(
        entry.address,
        options.allowPrivateNetwork ?? false,
      );
    } catch (cause) {
      throw unprocessable(
        cause instanceof Error
          ? cause.message
          : "This integration endpoint is not allowed",
      );
    }
  }
  return url;
}

export async function integrationFetch(
  raw: string,
  init: RequestInit & { allowPrivateNetwork?: boolean } = {},
) {
  const { allowPrivateNetwork, ...request } = init;
  const url = await assertSafeOutboundUrl(raw, { allowPrivateNetwork });
  return networkFetch(url, {
    ...request,
    dispatcher: allowPrivateNetwork ? privateNetworkAgent : publicNetworkAgent,
    redirect: "error",
    signal: request.signal ?? AbortSignal.timeout(15_000),
  } as unknown as NonNullable<
    Parameters<typeof networkFetch>[1]
  >) as unknown as Promise<Response>;
}
