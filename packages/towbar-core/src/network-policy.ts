import { lookup as lookupCallback } from "node:dns";
import { Agent as HttpsAgent } from "node:https";
import { isIP } from "node:net";

import type { LookupFunction } from "node:net";

function alwaysBlockedIpv4(address: string) {
  const parts = address.split(".").map(Number);
  const [first, second] = parts;
  return (
    first === 0 ||
    first === 127 ||
    (first === 100 && second! >= 64 && second! <= 127) ||
    (first === 169 && second === 254) ||
    (first === 192 && second === 0) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first! >= 224
  );
}

function alwaysBlockedIpv6(address: string) {
  const normalized = address.toLowerCase();
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("ff")
  );
}

function isPrivateAddress(address: string) {
  const normalized = address.toLowerCase();
  const mapped = normalized.startsWith("::ffff:")
    ? normalized.slice("::ffff:".length)
    : normalized;
  if (isIP(mapped) === 4) {
    const [first, second] = mapped.split(".").map(Number);
    return (
      first === 10 ||
      (first === 172 && second! >= 16 && second! <= 31) ||
      (first === 192 && second === 168)
    );
  }
  return normalized.startsWith("fc") || normalized.startsWith("fd");
}

export function assertNetworkAddressAllowed(
  address: string,
  allowPrivateNetwork: boolean,
) {
  const normalized = address.toLowerCase();
  const mapped = normalized.startsWith("::ffff:")
    ? normalized.slice("::ffff:".length)
    : normalized;
  if (
    (isIP(mapped) === 4 && alwaysBlockedIpv4(mapped)) ||
    (isIP(normalized) === 6 && alwaysBlockedIpv6(normalized)) ||
    isIP(normalized) === 0
  )
    throw new Error("This integration endpoint is not allowed");
  if (isPrivateAddress(normalized) && !allowPrivateNetwork)
    throw new Error(
      "Private network endpoints require allowPrivateNetwork to be enabled",
    );
}

export function createPolicyLookup(
  allowPrivateNetwork: boolean,
): LookupFunction {
  return (hostname, options, callback) => {
    lookupCallback(
      hostname,
      { ...options, all: true, verbatim: true },
      (error, addresses) => {
        if (error) return callback(error, "", 0);
        try {
          if (!addresses.length) throw new Error("Endpoint did not resolve");
          for (const entry of addresses)
            assertNetworkAddressAllowed(entry.address, allowPrivateNetwork);
          if (options.all) return callback(null, addresses);
          const selected = addresses[0]!;
          return callback(null, selected.address, selected.family);
        } catch (cause) {
          return callback(
            cause instanceof Error ? cause : new Error(String(cause)),
            "",
            0,
          );
        }
      },
    );
  };
}

export function createPolicyHttpsAgent(input: {
  allowPrivateNetwork: boolean;
  ca?: string[];
}) {
  return new HttpsAgent({
    ...(input.ca ? { ca: input.ca } : {}),
    lookup: createPolicyLookup(input.allowPrivateNetwork),
  });
}
