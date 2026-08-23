import { deployments } from "@workspace/towbar-database/schema";
import { sql } from "drizzle-orm";

export type PublicDeploymentTrigger = "auto_deploy" | "manual" | "rollback";

/** Fields safe and useful for authenticated dashboard responses. */
export const publicDeploymentSelection = {
  appId: deployments.appId,
  commitSha: deployments.commitSha,
  deployableKind: deployments.deployableKind,
  createdAt: deployments.createdAt,
  errorCode: deployments.errorCode,
  errorMessage: deployments.errorMessage,
  finishedAt: deployments.finishedAt,
  id: deployments.id,
  kind: deployments.kind,
  manifestDigest: deployments.manifestDigest,
  serverId: deployments.serverId,
  sourceId: deployments.sourceId,
  startedAt: deployments.startedAt,
  state: deployments.state,
  trigger: sql<PublicDeploymentTrigger>`case
    when ${deployments.kind} = 'rollback' then 'rollback'
    when ${deployments.requestedBy} is null then 'auto_deploy'
    else 'manual'
  end`.as("trigger"),
  updatedAt: deployments.updatedAt,
} as const;
