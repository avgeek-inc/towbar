import { and, desc, eq, inArray, isNull, ne, notInArray } from "drizzle-orm";

import {
  ManifestValidationError,
  buildBlockedDeploymentPlan,
  buildDeploymentPlan,
  digestValue,
  parseDeploymentManifest,
} from "@workspace/towbar-core";
import {
  apps,
  deploymentPlanGithubChecks,
  deploymentPlans,
  deployments,
  githubInstallations,
  resourceOperations,
  serverChecks,
  serverPreparations,
  servers,
  sourceSyncs,
  sources,
} from "@workspace/towbar-database/schema";

import { HttpError, conflict, notFound } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { inspectManagedSecrets } from "../secrets/plan-checks.js";
import { fetchGitHubManifestSnapshot } from "../github/client.js";
import { listSourceCapacity } from "../servers/capacity.js";
import {
  calculateDesiredDeploymentDigests,
  fetchRepositoryTreeForDeploymentInputs,
} from "../sources/deployment-digests.js";
import {
  assertStableDeployableKinds,
  loadCurrentInventory,
} from "../sources/inventory.js";
import {
  buildCandidateDeploymentPlanValidationChecks,
  buildDeploymentPlanValidationChecks,
  buildDeploymentPlanValidationScope,
} from "./validation.js";
import { pullRequestDeploymentPlanIdentity } from "./identity.js";

import type {
  DeploymentPlan,
  DeploymentPlanCheck,
  RepositoryChangedPaths,
} from "@workspace/towbar-core";
import type { GitHubPullRequest } from "../github/client.js";

const publicPlanSelection = {
  branch: deploymentPlans.branch,
  createdAt: deploymentPlans.createdAt,
  currentCommitSha: deploymentPlans.currentCommitSha,
  currentManifestDigest: deploymentPlans.currentManifestDigest,
  id: deploymentPlans.id,
  plan: deploymentPlans.plan,
  pullRequestNumber: deploymentPlans.pullRequestNumber,
  sourceId: deploymentPlans.sourceId,
  status: deploymentPlans.status,
  targetCommitSha: deploymentPlans.targetCommitSha,
  targetManifestDigest: deploymentPlans.targetManifestDigest,
  trigger: deploymentPlans.trigger,
};

export async function createPullRequestDeploymentPlan(input: {
  pullRequest: GitHubPullRequest;
  repositoryChanges: RepositoryChangedPaths;
  sourceId: string;
  workspaceId: string;
}) {
  const source = await getPlanningSource(input.sourceId, input.workspaceId);
  let candidate: { commitSha: string; manifestSource: string };
  try {
    candidate = await fetchGitHubManifestSnapshot({
      ...source,
      commitSha: input.pullRequest.headSha,
    });
  } catch (error) {
    if (!isPersistableCandidateError(error)) throw error;
    return await persistDeploymentPlan({
      branch: input.pullRequest.headBranch,
      candidateDigest: digestValue({
        commitSha: input.pullRequest.headSha,
        manifestAvailable: false,
      }),
      plan: buildBlockedDeploymentPlan(planChecksFromCandidateError(error)),
      pullRequestNumber: input.pullRequest.number,
      source,
      targetCommitSha: input.pullRequest.headSha,
      targetManifestDigest: null,
    });
  }
  return await createAndPersistPullRequestDeploymentPlan({
    branch: input.pullRequest.headBranch,
    candidate,
    pullRequestNumber: input.pullRequest.number,
    repositoryChanges: input.repositoryChanges,
    source,
  });
}

export async function listDeploymentPlans(input: {
  sourceId: string;
  workspaceId: string;
}) {
  await assertSourceAccess(input.sourceId, input.workspaceId);
  return await getTowbarDatabase()
    .select({
      ...publicPlanSelection,
      githubCheckStatus: deploymentPlanGithubChecks.status,
    })
    .from(deploymentPlans)
    .leftJoin(
      deploymentPlanGithubChecks,
      eq(deploymentPlanGithubChecks.planId, deploymentPlans.id),
    )
    .where(
      and(
        eq(deploymentPlans.sourceId, input.sourceId),
        eq(deploymentPlans.trigger, "pull_request"),
      ),
    )
    .orderBy(desc(deploymentPlans.createdAt), desc(deploymentPlans.id));
}

export async function getDeploymentPlan(input: {
  planId: string;
  sourceId: string;
  workspaceId: string;
}) {
  const [plan] = await getTowbarDatabase()
    .select({
      ...publicPlanSelection,
      githubCheckError: deploymentPlanGithubChecks.errorMessage,
      githubCheckRunId: deploymentPlanGithubChecks.checkRunId,
      githubCheckStatus: deploymentPlanGithubChecks.status,
    })
    .from(deploymentPlans)
    .leftJoin(
      deploymentPlanGithubChecks,
      eq(deploymentPlanGithubChecks.planId, deploymentPlans.id),
    )
    .where(
      and(
        eq(deploymentPlans.id, input.planId),
        eq(deploymentPlans.sourceId, input.sourceId),
        eq(deploymentPlans.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);
  if (!plan) throw notFound("Deployment plan");
  return plan;
}

async function createAndPersistPullRequestDeploymentPlan(input: {
  branch: string;
  candidate: { commitSha: string; manifestSource: string };
  pullRequestNumber: number;
  repositoryChanges: RepositoryChangedPaths;
  source: PlanningSource;
}) {
  const candidateDigest = digestValue(input.candidate.manifestSource);
  let targetManifestDigest: string | null = null;
  let plan: DeploymentPlan;
  try {
    const parsed = parseDeploymentManifest(input.candidate.manifestSource);
    targetManifestDigest = parsed.digest;
    const [current, repositoryTree] = await Promise.all([
      loadCurrentInventory(input.source.id),
      fetchRepositoryTreeForDeploymentInputs({
        commitSha: input.candidate.commitSha,
        manifestApps: parsed.manifest.apps,
        repository: input.source,
      }),
    ]);
    const staticChecks = buildCandidateDeploymentPlanValidationChecks({
      manifest: parsed.manifest,
      sourceBranch: input.source.branch,
    });
    const kindChecks: DeploymentPlanCheck[] = [];
    try {
      assertStableDeployableKinds(current, parsed.manifest);
    } catch (error) {
      kindChecks.push(planCheckFromError(error, "deployable_kind"));
    }
    const targetDigests = calculateDesiredDeploymentDigests({
      commitSha: input.candidate.commitSha,
      manifest: parsed.manifest,
      repositoryTree,
    });
    const planInput = {
      currentApps: current.apps,
      currentResources: current.resources,
      currentServers: current.servers,
      desired: parsed.manifest,
      mode: "pull_request" as const,
      repositoryChanges: input.repositoryChanges,
      targetDeploymentDigests: new Map(
        [...targetDigests].map(([id, digest]) => [id, digest.deploymentDigest]),
      ),
    };
    const candidatePlan = buildDeploymentPlan({
      ...planInput,
      checks: [...staticChecks, ...kindChecks],
    });
    if (candidatePlan.status === "skipped") {
      plan = candidatePlan;
    } else {
      const scope = buildDeploymentPlanValidationScope({
        items: candidatePlan.items,
        manifest: parsed.manifest,
      });
      const context = await loadValidationContext(
        input.source,
        parsed.manifest,
        scope,
      );
      plan = buildDeploymentPlan({
        ...planInput,
        checks: buildDeploymentPlanValidationChecks({
          context,
          manifest: parsed.manifest,
          scope,
        }).concat(kindChecks),
      });
    }
  } catch (error) {
    if (!isPersistableCandidateError(error)) throw error;
    plan = buildBlockedDeploymentPlan(planChecksFromCandidateError(error));
  }

  return await persistDeploymentPlan({
    branch: input.branch,
    candidateDigest,
    plan,
    pullRequestNumber: input.pullRequestNumber,
    source: input.source,
    targetCommitSha: input.candidate.commitSha,
    targetManifestDigest,
  });
}

async function persistDeploymentPlan(input: {
  branch: string;
  candidateDigest: string;
  plan: DeploymentPlan;
  pullRequestNumber: number;
  source: PlanningSource;
  targetCommitSha: string;
  targetManifestDigest: string | null;
}) {
  const identityDigest = pullRequestDeploymentPlanIdentity({
    pullRequestNumber: input.pullRequestNumber,
    sourceId: input.source.id,
    targetCommitSha: input.targetCommitSha,
  });
  const database = getTowbarDatabase();
  const [inserted] = await database
    .insert(deploymentPlans)
    .values({
      branch: input.branch,
      candidateDigest: input.candidateDigest,
      currentCommitSha: input.source.latestCommitSha,
      currentManifestDigest: input.source.latestManifestDigest,
      identityDigest,
      plan: input.plan,
      pullRequestNumber: input.pullRequestNumber,
      requestedBy: null,
      sourceId: input.source.id,
      status: input.plan.status,
      targetCommitSha: input.targetCommitSha,
      targetManifestDigest: input.targetManifestDigest,
      trigger: "pull_request",
      workspaceId: input.source.workspaceId,
    })
    .onConflictDoNothing()
    .returning(publicPlanSelection);
  const [updated] = inserted
    ? []
    : await database
        .update(deploymentPlans)
        .set({
          branch: input.branch,
          candidateDigest: input.candidateDigest,
          currentCommitSha: input.source.latestCommitSha,
          currentManifestDigest: input.source.latestManifestDigest,
          identityDigest,
          plan: input.plan,
          status: input.plan.status,
          targetManifestDigest: input.targetManifestDigest,
        })
        .where(
          and(
            eq(deploymentPlans.sourceId, input.source.id),
            eq(deploymentPlans.pullRequestNumber, input.pullRequestNumber),
            eq(deploymentPlans.targetCommitSha, input.targetCommitSha),
            eq(deploymentPlans.trigger, "pull_request"),
          ),
        )
        .returning(publicPlanSelection);
  const persisted = inserted ?? updated;
  if (!persisted) throw new Error("Unable to persist deployment plan");
  await database
    .insert(deploymentPlanGithubChecks)
    .values({ planId: persisted.id })
    .onConflictDoNothing();
  return persisted;
}

async function getPlanningSource(sourceId: string, workspaceId: string) {
  const [source] = await getTowbarDatabase()
    .select({
      branch: sources.branch,
      id: sources.id,
      installationId: githubInstallations.installationId,
      latestCommitSha: sources.latestCommitSha,
      latestManifestDigest: sources.latestManifestDigest,
      repositoryName: sources.repositoryName,
      repositoryOwner: sources.repositoryOwner,
      status: sources.status,
      workspaceId: sources.workspaceId,
    })
    .from(sources)
    .innerJoin(
      githubInstallations,
      eq(githubInstallations.id, sources.githubInstallationId),
    )
    .where(and(eq(sources.id, sourceId), eq(sources.workspaceId, workspaceId)))
    .limit(1);
  if (!source) throw notFound("Source");
  if (source.status === "archived") {
    throw conflict("Archived Sources cannot be planned");
  }
  return source;
}

type PlanningSource = Awaited<ReturnType<typeof getPlanningSource>>;

async function assertSourceAccess(sourceId: string, workspaceId: string) {
  const [source] = await getTowbarDatabase()
    .select({ id: sources.id })
    .from(sources)
    .where(and(eq(sources.id, sourceId), eq(sources.workspaceId, workspaceId)))
    .limit(1);
  if (!source) throw notFound("Source");
}

async function loadValidationContext(
  source: PlanningSource,
  manifest: import("@workspace/towbar-core").NormalizedDeploymentManifest,
  scope: import("./validation.js").DeploymentPlanValidationScope,
) {
  const database = getTowbarDatabase();
  const [domainRows, serverRows, capacities, operations] = await Promise.all([
    database
      .select({ config: apps.config, manifestId: apps.manifestId })
      .from(apps)
      .where(
        and(
          eq(apps.workspaceId, source.workspaceId),
          ne(apps.sourceId, source.id),
          isNull(apps.archivedAt),
        ),
      ),
    database
      .select({
        config: servers.config,
        configDigest: servers.configDigest,
        ip: servers.canonicalIp,
        preparedAt: servers.preparedAt,
        preparedConfigDigest: servers.preparedConfigDigest,
      })
      .from(servers)
      .where(eq(servers.sourceId, source.id)),
    listSourceCapacity(source.workspaceId, source.id),
    loadActiveOperationDescriptions(source.id),
  ]);
  const secretBindings = await inspectManagedSecrets({
    manifest,
    scope,
    sourceId: source.id,
    workspaceId: source.workspaceId,
  });
  return {
    activeOperationDescriptions: operations,
    capacities,
    existingDomainClaims: domainRows.flatMap((row) =>
      row.config.domains
        ? [
            {
              domain: row.config.domains.primary,
              manifestId: row.manifestId,
            },
            ...row.config.domains.redirects.map((redirect) => ({
              domain: redirect.host,
              manifestId: row.manifestId,
            })),
          ]
        : [],
    ),
    materializedServers: serverRows,
    secretBindings,
    sourceBranch: source.branch,
  };
}

async function loadActiveOperationDescriptions(sourceId: string) {
  const database = getTowbarDatabase();
  const [
    activeDeployments,
    activeOperations,
    activeSyncs,
    activeChecks,
    activePreparations,
  ] = await Promise.all([
    database
      .select({ id: deployments.id })
      .from(deployments)
      .where(
        and(
          eq(deployments.sourceId, sourceId),
          notInArray(deployments.state, [
            "cancelled",
            "failed",
            "skipped",
            "succeeded",
            "succeeded_with_warnings",
          ]),
        ),
      )
      .limit(1),
    database
      .select({ id: resourceOperations.id })
      .from(resourceOperations)
      .where(
        and(
          eq(resourceOperations.sourceId, sourceId),
          inArray(resourceOperations.state, ["queued", "running"]),
        ),
      )
      .limit(1),
    database
      .select({ id: sourceSyncs.id })
      .from(sourceSyncs)
      .where(
        and(
          eq(sourceSyncs.sourceId, sourceId),
          inArray(sourceSyncs.status, ["queued", "running"]),
        ),
      )
      .limit(1),
    database
      .select({ id: serverChecks.id })
      .from(serverChecks)
      .innerJoin(servers, eq(servers.id, serverChecks.serverId))
      .where(
        and(
          eq(servers.sourceId, sourceId),
          inArray(serverChecks.status, ["queued", "running"]),
        ),
      )
      .limit(1),
    database
      .select({ id: serverPreparations.id })
      .from(serverPreparations)
      .innerJoin(servers, eq(servers.id, serverPreparations.serverId))
      .where(
        and(
          eq(servers.sourceId, sourceId),
          inArray(serverPreparations.status, ["queued", "running"]),
        ),
      )
      .limit(1),
  ]);
  return [
    ...(activeDeployments.length
      ? ["Wait for the active deployment to finish before executing this plan"]
      : []),
    ...(activeOperations.length
      ? [
          "Wait for the active Resource operation to finish before executing this plan",
        ]
      : []),
    ...(activeSyncs.length
      ? ["Wait for the active Source sync to finish before executing this plan"]
      : []),
    ...(activeChecks.length
      ? [
          "Wait for the active server check to finish before executing this plan",
        ]
      : []),
    ...(activePreparations.length
      ? [
          "Wait for the active server preparation to finish before executing this plan",
        ]
      : []),
  ];
}

function planChecksFromCandidateError(error: unknown): DeploymentPlanCheck[] {
  if (error instanceof ManifestValidationError) {
    return error.issues.map((issue) => ({
      code: "manifest_schema",
      message: `${issue.path.join(".") || "manifest"}: ${issue.message}`,
      status: "failed",
    }));
  }
  return [planCheckFromError(error, "candidate_unavailable")];
}

function isPersistableCandidateError(error: unknown) {
  return (
    error instanceof ManifestValidationError ||
    (error instanceof HttpError && error.status !== 429 && error.status < 500)
  );
}

function planCheckFromError(error: unknown, code: string): DeploymentPlanCheck {
  return {
    code,
    message:
      error instanceof Error ? error.message : "Candidate validation failed",
    status: "failed",
  };
}
