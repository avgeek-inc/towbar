import {
  distributionUrl,
  repositoryUrl,
} from "@workspace/towbar-core/repository-identity";
import type { TowbarUpdateInfo } from "@workspace/towbar-core";

import { getReleaseVersion } from "../../release-version.js";

const latestReleaseUrl = `${distributionUrl}/releases/latest.json`;
const releasesUrl = `${repositoryUrl}/releases/tag/`;
const stableVersion = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const successfulCacheMs = 15 * 60_000;
const unavailableCacheMs = 5 * 60_000;

let cached: { expiresAt: number; value: TowbarUpdateInfo } | undefined;
let pending: Promise<TowbarUpdateInfo> | undefined;

export async function getTowbarUpdateInfo(): Promise<TowbarUpdateInfo> {
  const installedVersion = getReleaseVersion();
  if (
    cached?.value.installedVersion === installedVersion &&
    Date.now() < cached.expiresAt
  )
    return cached.value;
  if (pending) return pending;

  pending = checkTowbarUpdates(installedVersion).then((value) => {
    cached = {
      expiresAt:
        Date.now() +
        (value.status === "unavailable"
          ? unavailableCacheMs
          : successfulCacheMs),
      value,
    };
    return value;
  });
  try {
    return await pending;
  } finally {
    pending = undefined;
  }
}

export async function checkTowbarUpdates(
  installedVersion: string,
  fetcher: typeof fetch = fetch,
): Promise<TowbarUpdateInfo> {
  const checkedAt = new Date().toISOString();
  const unavailable: TowbarUpdateInfo = {
    checkedAt,
    installedVersion,
    latestVersion: null,
    releaseUrl: null,
    status: "unavailable",
  };
  try {
    const response = await fetcher(latestReleaseUrl, {
      headers: {
        accept: "application/json",
        "user-agent": "towbar.dev",
      },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return unavailable;
    const release = (await response.json()) as {
      validated?: unknown;
      version?: unknown;
      commit?: unknown;
    };
    if (
      release.validated !== true ||
      typeof release.version !== "string" ||
      typeof release.commit !== "string" ||
      !/^[a-f0-9]{40}$/.test(release.commit)
    )
      return unavailable;
    const comparison = compareStableVersions(installedVersion, release.version);
    if (comparison === null) return unavailable;
    const latestVersion = release.version.replace(/^v/u, "");
    return {
      checkedAt,
      installedVersion,
      latestVersion,
      releaseUrl: `${releasesUrl}v${latestVersion}`,
      status:
        comparison < 0 ? "available" : comparison > 0 ? "ahead" : "current",
    };
  } catch {
    return unavailable;
  }
}

export function compareStableVersions(current: string, latest: string) {
  const currentParts = stableVersion.exec(current)?.slice(1).map(Number);
  const latestParts = stableVersion.exec(latest)?.slice(1).map(Number);
  if (
    !currentParts ||
    !latestParts ||
    [...currentParts, ...latestParts].some(
      (part) => !Number.isSafeInteger(part),
    )
  )
    return null;
  for (let index = 0; index < 3; index += 1) {
    if (currentParts[index]! < latestParts[index]!) return -1;
    if (currentParts[index]! > latestParts[index]!) return 1;
  }
  return 0;
}
