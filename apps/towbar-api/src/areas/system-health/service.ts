import { and, eq, isNull } from "drizzle-orm";

import {
  githubInstallations,
  sourceAwsCredentials,
  sources,
} from "@workspace/towbar-database/schema";
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
import { verifyStoredAwsCredentials } from "../aws/service.js";
import { getGitHubInstallation } from "../github/client.js";
import { getRuntimeCapacity } from "./capacity.js";
import {
  listSystemHealthSignals,
  recordSystemHealthSignal,
  systemHealthStatusSchema,
} from "./signals.js";

import type { SystemHealthSignal } from "./signals.js";

export { recordMaintenanceHeartbeat } from "./signals.js";

export async function getSystemHealth(
  workspaceId: string,
): Promise<SystemHealth> {
  await pingDatabase();
  const [signals, runtimeCapacity, githubConnection, awsCredentials] =
    await Promise.all([
      listSystemHealthSignals(workspaceId),
      getRuntimeCapacity(workspaceId),
      getTowbarDatabase()
        .select({
          accountLogin: githubInstallations.accountLogin,
          suspendedAt: githubInstallations.suspendedAt,
        })
        .from(githubInstallations)
        .where(eq(githubInstallations.workspaceId, workspaceId))
        .limit(1),
      getTowbarDatabase()
        .select({
          sourceId: sourceAwsCredentials.sourceId,
          status: sourceAwsCredentials.verificationStatus,
          verifiedAt: sourceAwsCredentials.verifiedAt,
        })
        .from(sourceAwsCredentials)
        .where(eq(sourceAwsCredentials.workspaceId, workspaceId)),
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
    githubCheck({
      configured: githubConfigured(env),
      connection: githubConnection[0],
      signal: byComponent.get("github"),
    }),
    awsCheck({ credentials: awsCredentials, signal: byComponent.get("aws") }),
  ];
  return {
    checkedAt: new Date().toISOString(),
    checks,
    runtimeCapacity,
    status: highestStatus([
      ...checks.map((check) => check.status),
      ...runtimeCapacity.map((item) => item.status),
    ]),
    version,
  };
}

export async function runSystemHealthChecks(workspaceId: string) {
  const env = getEnv();
  const version = env.TOWBAR_COMMIT_SHA ?? env.SOURCE_COMMIT;
  await Promise.all([
    checkTemporal(workspaceId, version),
    checkGitHub(workspaceId),
    checkAws(workspaceId),
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

async function checkAws(workspaceId: string) {
  const activeSources = await getTowbarDatabase()
    .select({ id: sources.id })
    .from(sources)
    .where(
      and(
        eq(sources.workspaceId, workspaceId),
        eq(sources.status, "active"),
        isNull(sources.archivedAt),
      ),
    );
  if (activeSources.length === 0) {
    await recordSystemHealthSignal({
      component: "aws",
      details: { sources: 0 },
      key: `${workspaceId}:aws`,
      message: "AWS access will be checked after the first Source is added.",
      status: "unknown",
      workspaceId,
    });
    return;
  }
  const results = [];
  for (let index = 0; index < activeSources.length; index += 4) {
    results.push(
      ...(await Promise.all(
        activeSources
          .slice(index, index + 4)
          .map((source) =>
            verifyStoredAwsCredentials({ sourceId: source.id, workspaceId }),
          ),
      )),
    );
  }
  const healthy = results.filter(
    (result) => result.status === "healthy",
  ).length;
  await recordSystemHealthSignal({
    component: "aws",
    details: { healthy, sources: results.length },
    key: `${workspaceId}:aws`,
    message:
      healthy === results.length
        ? `AWS verified credentials for ${healthy} ${healthy === 1 ? "Source" : "Sources"}.`
        : `AWS verified ${healthy} of ${results.length} Source credentials.`,
    status: healthy === results.length ? "healthy" : "critical",
    workspaceId,
  });
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

function githubCheck(input: {
  configured: boolean;
  connection: { accountLogin: string; suspendedAt: Date | null } | undefined;
  signal: SystemHealthSignal | undefined;
}): SystemHealthCheck {
  const status: SystemHealthStatus = !input.configured
    ? "critical"
    : input.connection?.suspendedAt
      ? "critical"
      : input.signal
        ? freshSignalStatus(input.signal, 24 * 60 * 60_000)
        : "attention";
  return {
    checkedAt: input.signal?.checkedAt.toISOString() ?? null,
    description:
      input.signal?.message ??
      (!input.configured
        ? "Complete the GitHub App environment before connecting repositories."
        : input.connection
          ? `Connected to ${input.connection.accountLogin}; run checks to verify access.`
          : "Install the GitHub App before adding a Source."),
    id: "github",
    remediationHref: status === "healthy" ? null : "/settings?section=github",
    remediationLabel: status === "healthy" ? null : "Open GitHub settings",
    status,
    title: "GitHub App",
  };
}

function awsCheck(input: {
  credentials: Array<{
    sourceId: string;
    status: string;
    verifiedAt: Date | null;
  }>;
  signal: SystemHealthSignal | undefined;
}): SystemHealthCheck {
  const verified = input.credentials.filter(
    (item) => item.status === "verified",
  ).length;
  const status = input.signal
    ? freshSignalStatus(input.signal, 24 * 60 * 60_000)
    : input.credentials.length === 0
      ? "unknown"
      : verified === input.credentials.length
        ? "attention"
        : "critical";
  return {
    checkedAt:
      input.signal?.checkedAt.toISOString() ??
      input.credentials
        .map((item) => item.verifiedAt)
        .filter((value): value is Date => Boolean(value))
        .sort((left, right) => right.getTime() - left.getTime())[0]
        ?.toISOString() ??
      null,
    description:
      input.signal?.message ??
      (input.credentials.length === 0
        ? "AWS access will be checked after a Source credential is saved."
        : verified === input.credentials.length
          ? `${verified} Source ${verified === 1 ? "credential was" : "credentials were"} verified when saved. Run checks to verify again.`
          : `${input.credentials.length - verified} Source ${input.credentials.length - verified === 1 ? "credential needs" : "credentials need"} attention.`),
    id: "aws",
    remediationHref: null,
    remediationLabel: null,
    status,
    title: "AWS access",
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

function freshSignalStatus(
  signal: SystemHealthSignal,
  staleAfterMs: number,
): SystemHealthStatus {
  const current = systemHealthStatusSchema.parse(signal.status);
  return Date.now() - signal.checkedAt.getTime() > staleAfterMs
    ? highestStatus([current, "attention"])
    : current;
}

function githubConfigured(env: ReturnType<typeof getEnv>) {
  return Boolean(
    env.GITHUB_APP_ID &&
    env.GITHUB_APP_SLUG &&
    (env.GITHUB_APP_PRIVATE_KEY || env.GITHUB_APP_PRIVATE_KEY_BASE64) &&
    env.GITHUB_WEBHOOK_SECRET,
  );
}
