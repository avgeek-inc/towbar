import { createReadStream, createWriteStream } from "node:fs";
import { lstat, mkdir, opendir, realpath } from "node:fs/promises";
import { lookup as lookupCallback } from "node:dns";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { Agent, fetch as networkFetch } from "undici";

import { runCommand } from "./process.js";

import type { DeploymentExecutionContext } from "./types.js";
import type { LookupFunction } from "node:net";

export const MAX_SOURCE_ARCHIVE_BYTES = 512 * 1024 * 1024;
export const MAX_SOURCE_EXPANDED_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_SOURCE_ARCHIVE_ENTRIES = 100_000;

export function createSourceArchiveLimit(maxBytes = MAX_SOURCE_ARCHIVE_BYTES) {
  let receivedBytes = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      receivedBytes += chunk.byteLength;
      if (receivedBytes > maxBytes) {
        callback(
          new Error(
            `Repository source archive exceeds the ${maxBytes}-byte safety limit`,
          ),
        );
        return;
      }
      callback(null, chunk);
    },
  });
}

export async function inspectSourceArchive(
  archivePath: string,
  options: {
    maxBytes?: number;
    maxEntries?: number;
    signal?: AbortSignal;
  } = {},
) {
  const inspector = createExpandedArchiveLimit({
    maxBytes: options.maxBytes ?? MAX_SOURCE_EXPANDED_BYTES,
    maxEntries: options.maxEntries ?? MAX_SOURCE_ARCHIVE_ENTRIES,
  });
  await pipeline(
    createReadStream(archivePath),
    createGunzip(),
    inspector,
    options.signal ? { signal: options.signal } : {},
  );
}

export function createExpandedArchiveLimit(input: {
  maxBytes: number;
  maxEntries: number;
}) {
  let expandedBytes = 0;
  let entries = 0;
  let buffered = Buffer.alloc(0);
  let remainingPayloadBytes = 0;

  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      try {
        expandedBytes += chunk.byteLength;
        if (expandedBytes > input.maxBytes) {
          throw new Error(
            `Expanded source archive exceeds the ${input.maxBytes}-byte safety limit`,
          );
        }
        buffered = buffered.length
          ? Buffer.concat([buffered, chunk])
          : Buffer.from(chunk);
        while (buffered.length > 0) {
          if (remainingPayloadBytes > 0) {
            const consumed = Math.min(remainingPayloadBytes, buffered.length);
            buffered = buffered.subarray(consumed);
            remainingPayloadBytes -= consumed;
            continue;
          }
          if (buffered.length < 512) break;
          const header = buffered.subarray(0, 512);
          buffered = buffered.subarray(512);
          if (header.every((value) => value === 0)) continue;
          entries += 1;
          if (entries > input.maxEntries) {
            throw new Error(
              `Source archive exceeds the ${input.maxEntries}-entry safety limit`,
            );
          }
          const size = parseTarSize(header.subarray(124, 136));
          remainingPayloadBytes = Math.ceil(size / 512) * 512;
        }
        callback();
      } catch (error) {
        callback(error instanceof Error ? error : new Error(String(error)));
      }
    },
    flush(callback) {
      if (remainingPayloadBytes > 0) {
        callback(new Error("Source archive ended inside a file payload"));
        return;
      }
      if (buffered.length > 0 && !buffered.every((value) => value === 0)) {
        callback(new Error("Source archive ended inside a tar header"));
        return;
      }
      callback();
    },
  });
}

export async function fetchDeploymentSource(
  context: DeploymentExecutionContext,
  localDirectory: string,
  signal?: AbortSignal,
) {
  if (!context.sourceCredential) {
    throw new Error("Repository credentials are required to fetch source");
  }
  const archivePath = path.join(localDirectory, "source.tar.gz");
  const checkoutPath = path.join(localDirectory, "checkout");
  await mkdir(checkoutPath, { mode: 0o700 });
  const credential = context.sourceCredential;
  const owner = encodeURIComponent(context.repositoryOwner);
  const repository = encodeURIComponent(context.repositoryName);
  const url =
    credential.provider === "github"
      ? `${credential.apiUrl.replace(/\/$/u, "")}/repos/${owner}/${repository}/tarball/${context.commitSha}`
      : `${credential.baseUrl.replace(/\/$/u, "")}/api/v4/projects/${encodeURIComponent(credential.projectId)}/repository/archive.tar.gz?sha=${encodeURIComponent(context.commitSha)}`;
  if (credential.provider === "gitlab") {
    await assertAllowedSourceEndpoint(url, credential.allowPrivateNetwork);
  }
  const response =
    credential.provider === "github"
      ? await globalThis.fetch(url, {
          headers: {
            accept: "application/vnd.github+json",
            authorization: `Bearer ${credential.token}`,
            "user-agent": "towbar.dev",
            "x-github-api-version": "2022-11-28",
          },
          redirect: "follow",
          signal,
        })
      : await networkFetch(url, {
          dispatcher: credential.allowPrivateNetwork
            ? privateSourceAgent
            : publicSourceAgent,
          headers: {
            authorization: `Bearer ${credential.token}`,
            "user-agent": "towbar.dev",
          },
          redirect: "error",
          signal,
        });
  if (!response.ok || !response.body) {
    throw new Error(
      `${credential.provider === "github" ? "GitHub" : "GitLab"} archive request failed with status ${response.status}`,
    );
  }
  const declaredSize = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredSize) &&
    declaredSize > MAX_SOURCE_ARCHIVE_BYTES
  ) {
    throw new Error(
      `Repository source archive exceeds the ${MAX_SOURCE_ARCHIVE_BYTES}-byte safety limit`,
    );
  }
  await pipeline(
    Readable.fromWeb(response.body as never),
    createSourceArchiveLimit(),
    createWriteStream(archivePath, { mode: 0o600 }),
  );
  await inspectSourceArchive(archivePath, { signal });
  await runCommand(
    "tar",
    [
      "-xzf",
      archivePath,
      "--strip-components=1",
      "--no-same-owner",
      "--no-same-permissions",
      "-C",
      checkoutPath,
    ],
    { signal, timeoutMs: 120_000 },
  );
  await validateExtractedCheckout(checkoutPath);
  return checkoutPath;
}

async function validateExtractedCheckout(checkoutPath: string) {
  const root = await realpath(checkoutPath);
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop()!;
    const entries = await opendir(directory);
    for await (const entry of entries) {
      const candidate = path.join(directory, entry.name);
      const metadata = await lstat(candidate);
      if (metadata.isDirectory()) {
        pending.push(candidate);
        continue;
      }
      if (metadata.isFile()) continue;
      if (metadata.isSymbolicLink()) {
        let resolved: string;
        try {
          resolved = await realpath(candidate);
        } catch {
          throw new Error("Repository source contains a broken symbolic link");
        }
        if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`))
          throw new Error(
            "Repository source contains a symbolic link outside the checkout",
          );
        continue;
      }
      throw new Error("Repository source contains an unsupported special file");
    }
  }
}

function sourcePolicyLookup(allowPrivate: boolean): LookupFunction {
  return (hostname, options, callback) => {
    lookupCallback(
      hostname,
      { ...options, all: true, verbatim: true },
      (error, addresses) => {
        if (error) return callback(error, "", 0);
        try {
          if (!addresses.length)
            throw new Error("Repository endpoint did not resolve");
          for (const entry of addresses)
            assertAllowedSourceAddress(entry.address, allowPrivate);
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

const publicSourceAgent = new Agent({
  connect: { lookup: sourcePolicyLookup(false) },
});
const privateSourceAgent = new Agent({
  connect: { lookup: sourcePolicyLookup(true) },
});

async function assertAllowedSourceEndpoint(
  urlValue: string,
  allowPrivate: boolean,
) {
  const url = new URL(urlValue);
  if (url.protocol !== "https:")
    throw new Error("Repository endpoints must use HTTPS");
  const hostname = url.hostname.toLowerCase().replace(/\.$/u, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "metadata.google.internal" ||
    hostname === "metadata" ||
    hostname === "169.254.169.254"
  ) {
    throw new Error("Repository endpoint is blocked by network policy");
  }
  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0)
    throw new Error("Repository endpoint did not resolve");
  for (const { address } of addresses) {
    assertAllowedSourceAddress(address, allowPrivate);
  }
}

function assertAllowedSourceAddress(address: string, allowPrivate: boolean) {
  const normalized = address.toLowerCase();
  const mapped = normalized.startsWith("::ffff:")
    ? normalized.slice("::ffff:".length)
    : normalized;
  if (
    (isIP(mapped) === 4 && isAlwaysBlockedIpv4(mapped)) ||
    (isIP(normalized) === 6 && isAlwaysBlockedIpv6(normalized)) ||
    isIP(normalized) === 0
  )
    throw new Error("Repository endpoint is blocked by network policy");
  if (!allowPrivate && isPrivateAddress(address))
    throw new Error(
      "Repository endpoint resolves to a private network; enable the integration private-network policy explicitly",
    );
}

function isAlwaysBlockedIpv4(address: string) {
  const [first, second] = address.split(".").map(Number);
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

function isAlwaysBlockedIpv6(address: string) {
  return (
    address === "::" ||
    address === "::1" ||
    /^(?:fe8|fe9|fea|feb)/u.test(address) ||
    address.startsWith("ff")
  );
}

function isPrivateAddress(address: string) {
  const normalized = address.toLowerCase();
  const mapped = normalized.startsWith("::ffff:")
    ? normalized.slice("::ffff:".length)
    : normalized;
  if (mapped.startsWith("10.") || mapped.startsWith("192.168.")) return true;
  if (mapped.startsWith("172.")) {
    const octet = Number(mapped.split(".")[1]);
    if (octet >= 16 && octet <= 31) return true;
  }
  return normalized.startsWith("fc") || normalized.startsWith("fd");
}

function parseTarSize(field: Buffer) {
  if ((field[0] ?? 0) & 0x80) {
    const bytes = Buffer.from(field);
    bytes[0] = (bytes[0] ?? 0) & 0x7f;
    let value = 0n;
    for (const byte of bytes) value = value * 256n + BigInt(byte);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("Source archive contains an oversized tar entry");
    }
    return Number(value);
  }
  const value = field.toString("ascii").replace(/\0.*$/u, "").trim();
  if (!value) return 0;
  if (!/^[0-7]+$/u.test(value)) {
    throw new Error("Source archive contains an invalid tar entry size");
  }
  return Number.parseInt(value, 8);
}
