import { sourceSyncs, sources } from "@workspace/towbar-database/schema";

/** Public Source fields shared by create, detail, update, and list responses. */
export const publicSourceSelection = {
  branch: sources.branch,
  createdAt: sources.createdAt,
  id: sources.id,
  latestCommitSha: sources.latestCommitSha,
  latestManifestDigest: sources.latestManifestDigest,
  repositoryName: sources.repositoryName,
  repositoryOwner: sources.repositoryOwner,
  status: sources.status,
  updatedAt: sources.updatedAt,
};

/** A sync status deliberately excludes raw manifests and actor ownership. */
export const publicSourceSyncSelection = {
  commitSha: sourceSyncs.commitSha,
  createdAt: sourceSyncs.createdAt,
  finishedAt: sourceSyncs.finishedAt,
  id: sourceSyncs.id,
  issues: sourceSyncs.issues,
  manifestDigest: sourceSyncs.manifestDigest,
  reconciliation: sourceSyncs.reconciliation,
  startedAt: sourceSyncs.startedAt,
  status: sourceSyncs.status,
};
