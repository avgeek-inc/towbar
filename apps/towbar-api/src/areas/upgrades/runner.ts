import { readFile } from "node:fs/promises";
import { request } from "node:http";
import type {
  TowbarUpgradeJob,
  TowbarUpgradePlan,
  TowbarUpgradeStatus,
} from "@workspace/towbar-core";
import { HttpError } from "../../http/errors.js";

export async function hostUpgradeRequest<T>(
  path: "/status" | "/plan" | "/jobs",
  body?: unknown,
): Promise<T> {
  if (process.env.TOWBAR_HOST_UPGRADES !== "1") {
    throw new HttpError(
      409,
      "UPGRADE_UNSUPPORTED",
      "Use sudo towbar upgrade on the host. In-app upgrades are not enabled.",
    );
  }
  const token = await readFile("/run/towbar-upgrade/token", "utf8");
  return new Promise<T>((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      {
        socketPath: "/run/towbar-upgrade/runner.sock",
        path,
        method: data ? "POST" : "GET",
        headers: {
          authorization: `Bearer ${token}`,
          ...(data
            ? {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(data),
              }
            : {}),
        },
      },
      (res) => {
        let payload = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          payload += chunk;
          if (payload.length > 100_000)
            req.destroy(new Error("Host response too large"));
        });
        res.on("error", reject);
        res.on("end", () => {
          try {
            const result = JSON.parse(payload) as T & { error?: string };
            if (res.statusCode !== 200) {
              reject(
                new HttpError(
                  res.statusCode === 409 ? 409 : 503,
                  "UPGRADE_RUNNER_ERROR",
                  result.error ?? "The host upgrade runner is unavailable.",
                ),
              );
            } else resolve(result);
          } catch {
            reject(new Error("Invalid host upgrade response"));
          }
        });
      },
    );
    req.setTimeout(path === "/plan" ? 200_000 : 10_000, () =>
      req.destroy(new Error("Host runner timed out")),
    );
    req.on("error", reject);
    req.end(data);
  });
}

export async function getUpgradeStatus(): Promise<TowbarUpgradeStatus> {
  if (process.env.TOWBAR_HOST_UPGRADES !== "1")
    return {
      supported: false,
      job: null,
      reason:
        "Use sudo towbar upgrade on the host. In-app upgrades are not enabled.",
    };
  try {
    return await hostUpgradeRequest<TowbarUpgradeStatus>("/status");
  } catch {
    throw new HttpError(
      503,
      "UPGRADE_RUNNER_UNAVAILABLE",
      "The upgrade status is unavailable. See the recovery guide.",
    );
  }
}
export const prepareUpgrade = (targetVersion: string) =>
  hostUpgradeRequest<TowbarUpgradePlan>("/plan", { targetVersion });
export const startUpgrade = (body: {
  planId: string;
  requestId: string;
  actorId: string;
}) => hostUpgradeRequest<TowbarUpgradeJob>("/jobs", body);
