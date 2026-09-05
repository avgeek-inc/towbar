import { eq } from "drizzle-orm";

import { githubInstallations } from "@workspace/towbar-database/schema";
import type {
  SystemHealth,
  SystemHealthCheck,
  SystemHealthStatus,
} from "@workspace/towbar-core";

import { getEnv } from "../../env.js";
import {
  getTowbarDatabase,
  pingDatabase,
} from "../../infrastructure/database.js";
import { wakeMaintenanceWorkflow } from "../../infrastructure/temporal.js";
import {
  getAwsCredentialMetadata,
  reverifyAwsCredentials,
} from "../aws/service.js";
import { getGitHubInstallation } from "../github/client.js";
import {
  listSystemHealthSignals,
  recordSystemHealthSignal,
  systemHealthStatusSchema,
} from "./signals.js";

import { awsHealthCheck } from "./aws-check.js";
import { githubHealthCheck } from "./github-check.js";

import type { SystemHealthSignal } from "./signals.js";

export { recordMaintenanceHeartbeat } from "./signals.js";

export async function getSystemHealth(
  workspaceId: string,
): Promise<SystemHealth> {
  await pingDatabase();
  const [signals, githubConnection, awsCredential] = await Promise.all([
    listSystemHealthSignals(workspaceId),
    getTowbarDatabase()
      .select({
        accountLogin: githubInstallations.accountLogin,
        suspendedAt: githubInstallations.suspendedAt,
      })
      .from(githubInstallations)
      .where(eq(githubInstallations.workspaceId, workspaceId))
      .limit(1),
    getAwsCredentialMetadata(workspaceId),
  ]);
  const byComponent = new Map(
    signals.map((signal) => [signal.component, signal]),
  );
  const env = getEnv();
  const version = env.TOWBAR_COMMIT_SHA ?? env.SOURCE_COMMIT;
  const checks: SystemHealthCheck[] = [
    {
      checkedAt: new Date().toISOString(),
      description:
        "The API is responding and the current database schema is queryable.",
      id: "api-database",
      remediationHref: null,
      remediationLabel: null,
      status: "healthy",
      title: "API and database",
    },
    signalCheck({
      description:
        "Run checks to verify that Temporal accepts maintenance work.",
      id: "temporal",
      signal: byComponent.get("temporal"),
      staleAfterMs: 24 * 60 * 60_000,
      title: "Temporal",
    }),
    signalCheck({
      description: "Waiting for the first maintenance sweep from the worker.",
      id: "worker",
      signal: byComponent.get("worker"),
      staleAfterMs: 12 * 60_000,
      title: "Worker and maintenance",
      version,
    }),
    githubHealthCheck({
      configured: githubConfigured(env),
      connection: githubConnection[0],
      signal: byComponent.get("github"),
    }),
    ...(awsCredential ? [awsHealthCheck(awsCredential)] : []),
  ];
  return {
    checkedAt: new Date().toISOString(),
    checks,
    status: highestStatus(checks.map((check) => check.status)),
    version,
  };
}

export async function runSystemHealthChecks(workspaceId: string) {
  const env = getEnv();
  const version = env.TOWBAR_COMMIT_SHA ?? env.SOURCE_COMMIT;
  await Promise.all([
    checkTemporal(workspaceId, version),
    checkGitHub(workspaceId),
    reverifyAwsCredentials(workspaceId),
  ]);
  return await getSystemHealth(workspaceId);
}

async function checkTemporal(workspaceId: string, version: string) {
  try {
    await wakeMaintenanceWorkflow();
    await recordSystemHealthSignal({
      component: "temporal",
      details: {},
      key: `${workspaceId}:temporal`,
      message:
        "Temporal accepted a signal for the durable maintenance workflow.",
      status: "healthy",
      version,
      workspaceId,
    });
  } catch {
    await recordSystemHealthSignal({
      component: "temporal",
      details: {},
      key: `${workspaceId}:temporal`,
      message:
        "Temporal did not accept maintenance work. Check its endpoint and credentials.",
      status: "critical",
      version,
      workspaceId,
    });
  }
}

async function checkGitHub(workspaceId: string) {
  if (!githubConfigured(getEnv())) {
    await recordSystemHealthSignal({
      component: "github",
      details: {},
      key: `${workspaceId}:github`,
      message: "The GitHub App environment is incomplete.",
      status: "critical",
      workspaceId,
    });
    return;
  }
  const [connection] = await getTowbarDatabase()
    .select({ installationId: githubInstallations.installationId })
    .from(githubInstallations)
    .where(eq(githubInstallations.workspaceId, workspaceId))
    .limit(1);
  if (!connection) {
    await recordSystemHealthSignal({
      component: "github",
      details: {},
      key: `${workspaceId}:github`,
      message: "Install the GitHub App before adding a Source.",
      status: "attention",
      workspaceId,
    });
    return;
  }
  try {
    const installation = await getGitHubInstallation(connection.installationId);
    await recordSystemHealthSignal({
      component: "github",
      details: { account: installation.account.login },
      key: `${workspaceId}:github`,
      message: installation.suspended_at
        ? "The GitHub App installation is suspended."
        : `GitHub confirmed access to ${installation.account.login}.`,
      status: installation.suspended_at ? "critical" : "healthy",
      workspaceId,
    });
  } catch {
    await recordSystemHealthSignal({
      component: "github",
      details: {},
      key: `${workspaceId}:github`,
      message: "GitHub could not verify the connected App installation.",
      status: "critical",
      workspaceId,
    });
  }
}

function signalCheck(input: {
  description: string;
  id: "temporal" | "worker";
  signal: SystemHealthSignal | undefined;
  staleAfterMs: number;
  title: string;
  version?: string;
}): SystemHealthCheck {
  if (!input.signal) {
    return {
      checkedAt: null,
      description: input.description,
      id: input.id,
      remediationHref: null,
      remediationLabel: null,
      status: "unknown",
      title: input.title,
    };
  }
  const stale =
    Date.now() - input.signal.checkedAt.getTime() > input.staleAfterMs;
  const versionMismatch =
    input.version &&
    input.signal.version &&
    input.signal.version !== input.version;
  const currentStatus = systemHealthStatusSchema.parse(input.signal.status);
  return {
    checkedAt: input.signal.checkedAt.toISOString(),
    description: stale
      ? `${input.signal.message} The latest signal is stale.`
      : versionMismatch
        ? `${input.signal.message} The worker and API versions differ.`
        : input.signal.message,
    id: input.id,
    remediationHref: null,
    remediationLabel: null,
    status:
      stale || versionMismatch
        ? highestStatus([currentStatus, "attention"])
        : currentStatus,
    title: input.title,
  };
}

export function highestStatus(
  statuses: SystemHealthStatus[],
): SystemHealthStatus {
  const rank: Record<SystemHealthStatus, number> = {
    critical: 3,
    attention: 2,
    unknown: 1,
    healthy: 0,
  };
  return statuses.reduce(
    (highest, status) => (rank[status] > rank[highest] ? status : highest),
    "healthy",
  );
}

function githubConfigured(env: ReturnType<typeof getEnv>) {
  return Boolean(
    env.GITHUB_APP_ID &&
    env.GITHUB_APP_SLUG &&
    (env.GITHUB_APP_PRIVATE_KEY || env.GITHUB_APP_PRIVATE_KEY_BASE64) &&
    env.GITHUB_WEBHOOK_SECRET,
  );
}
