import { randomUUID } from "node:crypto";
import { repositoryUrl } from "@workspace/towbar-core/repository-identity";
import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  SystemHealth,
  TowbarUpgradeJob,
  TowbarUpgradePlan,
} from "@workspace/towbar-core";
import { fixtureJson } from "./fixture-localization.ts";

export type UpgradeScenario =
  | "ready"
  | "blocked"
  | "applying"
  | "failed"
  | "interrupted"
  | "succeeded"
  | "next-release"
  | "unsupported"
  | "reconnecting";

export function createUpgradeFixture(
  initial?: UpgradeScenario,
  health?: () => SystemHealth,
) {
  const checkedAt = new Date().toISOString();
  let scenario = initial ?? "unsupported";
  let job: TowbarUpgradeJob | null = null;
  const initialPlan: TowbarUpgradePlan = {
    id: randomUUID(),
    currentVersion: "v2.0.16",
    targetVersion: "v2.0.17",
    commit: "b".repeat(40),
    releaseUrl: `${repositoryUrl}/releases/tag/v2.0.17`,
    releaseNotes:
      "Improve deployment readiness checks and System Health reporting.\n\nSee queued operations before upgrading and reconnect automatically after a restart.",
    blockers: [],
    expiresAt: Date.now() / 1000 + 900,
  };
  let plan = { ...initialPlan };
  function setScenario(value: UpgradeScenario) {
    scenario = value;
    plan = { ...initialPlan, id: randomUUID() };
    job = [
      "applying",
      "failed",
      "interrupted",
      "succeeded",
      "next-release",
      "reconnecting",
    ].includes(value)
      ? {
          id: randomUUID(),
          planId: plan.id,
          currentVersion: plan.currentVersion,
          targetVersion: plan.targetVersion,
          commit: plan.commit,
          state:
            value === "reconnecting"
              ? "applying"
              : value === "next-release"
                ? "succeeded"
                : (value as TowbarUpgradeJob["state"]),
          message:
            value === "succeeded" || value === "next-release"
              ? "The new version is healthy. Deployments and operations can start again."
              : value === "interrupted"
                ? "The upgrade was interrupted before Towbar recorded a final result. Recovery is required before another upgrade."
                : value === "failed"
                  ? "The upgrade command failed while checking service health (exit code 1). New deployments and operations remain paused."
                  : "Applying migrations and replacing services. The dashboard may reconnect.",
          blockers: [],
          updatedAt: Date.now() / 1000,
        }
      : null;
    if (value === "next-release") {
      plan = {
        ...plan,
        id: randomUUID(),
        currentVersion: "v2.0.17",
        targetVersion: "v2.0.18",
        commit: "c".repeat(40),
        releaseUrl: `${repositoryUrl}/releases/tag/v2.0.18`,
      };
    }
  }
  const installedVersion = () =>
    (job?.state === "succeeded"
      ? job.targetVersion
      : (job?.currentVersion ?? plan.currentVersion)
    ).replace(/^v/u, "");
  setScenario(scenario);
  return async (
    request: IncomingMessage,
    response: ServerResponse,
    path: string,
  ) => {
    if (initial && path === "/__fixture/upgrade" && request.method === "POST") {
      let raw = "";
      for await (const chunk of request) raw += String(chunk);
      const { state } = JSON.parse(raw) as { state: UpgradeScenario };
      setScenario(state);
      writeJson(response, { ok: true });
      return true;
    }
    if (scenario === "reconnecting" && path === "/v1/public/auth/state") {
      response.writeHead(502, { "content-type": "application/json" });
      response.end(
        JSON.stringify({ error: { message: "Towbar API returned 502" } }),
      );
      return true;
    }
    if (initial && scenario !== "unsupported" && path === "/v1/core/version") {
      writeJson(response, {
        checkedAt,
        installedVersion: installedVersion(),
        latestVersion: plan.targetVersion.replace(/^v/u, ""),
        releaseUrl: plan.releaseUrl,
        status:
          `v${installedVersion()}` === plan.targetVersion
            ? "current"
            : "available",
      });
      return true;
    }
    if (
      initial &&
      scenario !== "unsupported" &&
      health &&
      path === "/v1/core/system-health"
    ) {
      writeJson(response, {
        ...health(),
        version: installedVersion(),
      });
      return true;
    }
    if (path === "/v1/core/system-health/upgrade") {
      if (scenario === "reconnecting") {
        response.writeHead(503, { "content-type": "application/json" });
        response.end(
          JSON.stringify({ error: { message: "The API is restarting." } }),
        );
      } else
        writeJson(response, {
          supported: scenario !== "unsupported",
          reason:
            "Use sudo towbar upgrade on the host. In-app upgrades are not enabled.",
          job,
        });
      return true;
    }
    if (path === "/v1/core/system-health/upgrade/plan") {
      writeJson(response, {
        ...plan,
        expiresAt: Date.now() / 1000 + 900,
        blockers:
          scenario === "blocked"
            ? ["Deployments: 2", "Resource operations: 1"]
            : [],
      });
      return true;
    }
    if (path === "/v1/core/system-health/upgrade/jobs") {
      const confirmedPlan = plan;
      setScenario("applying");
      plan = confirmedPlan;
      job = {
        ...job!,
        planId: plan.id,
        currentVersion: plan.currentVersion,
        targetVersion: plan.targetVersion,
        commit: plan.commit,
      };
      writeJson(response, job);
      return true;
    }
    return false;
  };
}

function writeJson(response: ServerResponse, body: unknown) {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(fixtureJson(response, body));
}
