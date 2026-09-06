import { Resolver } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import {
  type ScoutHttpCheck,
  scoutHttpCheckSchema,
} from "@workspace/towbar-core";

const blockedV4 = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blockedV4.addSubnet(address, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
const blockedV6 = new BlockList();
for (const [address, prefix] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const)
  blockedV6.addSubnet(address, prefix, "ipv6");
export function isPublicProbeAddress(address: string) {
  return isIP(address) === 4
    ? !blockedV4.check(address, "ipv4")
    : isIP(address) === 6 &&
        globalV6.check(address, "ipv6") &&
        !blockedV6.check(address, "ipv6");
}
class UnsafeProbeTarget extends Error {}
export type HttpProbeResult = {
  state: "healthy" | "failed" | "blocked";
  statusCode: number | null;
  latencyMs: number;
  reason: string | null;
};

type ProbeResponse = { status: number; location?: string };
export type ProbeTransport = {
  resolve: (host: string, signal: AbortSignal) => Promise<string[]>;
  request: (
    url: URL,
    address: string,
    method: "GET" | "HEAD",
    signal: AbortSignal,
  ) => Promise<ProbeResponse>;
};

/** New resolution for every hop. No cookies, credentials, proxies, body buffering or connection pool. */
export async function probePublicHttp(
  check: ScoutHttpCheck,
  transport: ProbeTransport = publicTransport,
): Promise<HttpProbeResult> {
  const config = scoutHttpCheckSchema.parse(check);
  const started = performance.now();
  const signal = AbortSignal.timeout(config.timeoutSeconds * 1000);
  try {
    let target = new URL(config.url);
    for (let hop = 0; hop <= config.maxRedirects; hop++) {
      const parsed = scoutHttpCheckSchema.safeParse({
        ...config,
        url: target.href,
      });
      if (!parsed.success)
        throw new UnsafeProbeTarget("Redirect target is not a public HTTP URL");
      const hostname = target.hostname.replace(/^\[|\]$/g, "");
      const addresses = isIP(hostname)
        ? [hostname]
        : await transport.resolve(hostname, signal);
      signal.throwIfAborted();
      if (!addresses.length) throw new Error("DNS returned no addresses");
      if (addresses.some((address) => !isPublicProbeAddress(address)))
        throw new UnsafeProbeTarget(
          "Target must resolve only to public network addresses",
        );
      const response = await transport.request(
        target,
        addresses[0]!,
        config.method,
        signal,
      );
      signal.throwIfAborted();
      if (
        config.maxRedirects > 0 &&
        [301, 302, 303, 307, 308].includes(response.status) &&
        response.location
      ) {
        if (hop === config.maxRedirects)
          return {
            state: "failed",
            statusCode: response.status,
            latencyMs: Math.round(performance.now() - started),
            reason: "Too many redirects",
          };
        target = new URL(response.location, target);
        continue;
      }
      const healthy =
        response.status >= config.expectedStatusMin &&
        response.status <= config.expectedStatusMax;
      return {
        state: healthy ? "healthy" : "failed",
        statusCode: response.status,
        latencyMs: Math.round(performance.now() - started),
        reason: healthy ? null : "Unexpected HTTP status",
      };
    }
    throw new Error("No response");
  } catch (error) {
    return {
      state: error instanceof UnsafeProbeTarget ? "blocked" : "failed",
      statusCode: null,
      latencyMs: Math.round(performance.now() - started),
      reason:
        error instanceof UnsafeProbeTarget
          ? error.message
          : signal.aborted
            ? "Request timed out"
            : "DNS, connection, or TLS check failed",
    };
  }
}

const publicTransport: ProbeTransport = {
  async resolve(host, signal) {
    const resolver = new Resolver({ timeout: 2000, tries: 1 });
    const cancel = () => resolver.cancel();
    signal.addEventListener("abort", cancel, { once: true });
    try {
      signal.throwIfAborted();
      const results = await Promise.allSettled([
        resolver.resolve4(host),
        resolver.resolve6(host),
      ]);
      signal.throwIfAborted();
      return results.flatMap((result) =>
        result.status === "fulfilled" ? result.value : [],
      );
    } finally {
      signal.removeEventListener("abort", cancel);
    }
  },
  request(url, address, method, signal) {
    return new Promise((resolve, reject) => {
      const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
        {
          protocol: url.protocol,
          hostname: address,
          port: url.port || undefined,
          servername: isIP(url.hostname.replace(/^\[|\]$/g, ""))
            ? undefined
            : url.hostname,
          path: `${url.pathname}${url.search}`,
          method,
          signal,
          agent: false,
          maxHeaderSize: 16384,
          headers: {
            host: url.host,
            "user-agent": "Towbar-Scout/1",
            accept: "*/*",
            "accept-encoding": "identity",
            connection: "close",
          },
        },
        (response) => {
          resolve({
            status: response.statusCode ?? 0,
            location: response.headers.location,
          });
          response.destroy();
          request.destroy();
        },
      );
      request.on("error", reject);
      request.on("upgrade", (_response, socket) => {
        socket.destroy();
        request.destroy();
        reject(new Error("Protocol upgrades are not supported"));
      });
      request.end();
    });
  },
};
