import { z } from "zod";

export const towbarTaskQueue = "towbar-deployments";
export const deploymentLogChunkCharacterLimit = 64 * 1_024;

export const deploymentStates = [
  "queued",
  "waiting_for_server",
  "preparing",
  "validating_credentials",
  "checking_server",
  "fetching_source",
  "resolving_secrets",
  "transferring",
  "building",
  "running_pre_deploy",
  "starting_candidate",
  "checking_health",
  "configuring_routing",
  "provisioning_tls",
  "checking_public_endpoint",
  "switching_traffic",
  "running_post_deploy",
  "cleaning_up",
  "succeeded",
  "succeeded_with_warnings",
  "skipped",
  "failed",
  "cancelled",
] as const;

export const deploymentStateSchema = z.enum(deploymentStates);
export type DeploymentState = z.infer<typeof deploymentStateSchema>;

export const terminalDeploymentStates = new Set<DeploymentState>([
  "succeeded",
  "succeeded_with_warnings",
  "skipped",
  "failed",
  "cancelled",
]);

const sequentialStates = deploymentStates.filter(
  (state) => !terminalDeploymentStates.has(state),
);
const allowedTransitions = new Map<DeploymentState, Set<DeploymentState>>();
sequentialStates.forEach((state, index) => {
  const next = sequentialStates[index + 1];
  allowedTransitions.set(
    state,
    new Set([
      ...(next ? [next] : ["succeeded", "succeeded_with_warnings"]),
      "failed",
      "cancelled",
    ] as DeploymentState[]),
  );
});
// Older workers do not emit the hook states. Keep these forward-only skips so
// an API upgrade cannot strand an already-running deployment at promotion.
allowedTransitions.get("building")?.add("starting_candidate");
allowedTransitions.get("switching_traffic")?.add("cleaning_up");
allowedTransitions.get("queued")?.add("skipped");
terminalDeploymentStates.forEach((state) =>
  allowedTransitions.set(state, new Set()),
);

export function canTransitionDeployment(
  from: DeploymentState,
  to: DeploymentState,
) {
  return allowedTransitions.get(from)?.has(to) ?? false;
}

export function assertDeploymentTransition(
  from: DeploymentState,
  to: DeploymentState,
) {
  if (!canTransitionDeployment(from, to)) {
    throw new Error(`Invalid deployment transition from '${from}' to '${to}'`);
  }
}

export const deploymentWorkflowInputSchema = z
  .object({
    deploymentId: z.string().uuid(),
  })
  .strict();

export type DeploymentWorkflowInput = z.infer<
  typeof deploymentWorkflowInputSchema
>;

export const previewPullRequestEventSchema = z
  .object({
    pullRequestNumber: z.number().int().positive().max(2_147_483_647),
    sourceId: z.string().uuid(),
  })
  .strict();

export type PreviewPullRequestEvent = z.infer<
  typeof previewPullRequestEventSchema
>;

export type ServerWorkItem =
  | {
      appId: string;
      buildConcurrency: number;
      id: string;
      kind: "deployment";
      previewBuildConcurrency?: number;
      priority?: "preview" | "production";
    }
  | {
      appId: string;
      buildConcurrency: number;
      id: string;
      kind: "preview-cleanup";
      previewBuildConcurrency: number;
      previewEnvironmentId: string;
    }
  | {
      buildConcurrency: number;
      id: string;
      kind: "server-check";
    }
  | {
      buildConcurrency: number;
      id: string;
      kind: "server-preparation";
    }
  | {
      appId: string | null;
      buildConcurrency: number;
      exclusive: boolean;
      id: string;
      kind: "resource-operation";
    };

export function deploymentWorkflowId(deploymentId: string) {
  return `towbar-deployment/${deploymentId}`;
}

export function resourceOperationWorkflowId(operationId: string) {
  return `towbar-resource-operation/${operationId}`;
}

export function maintenanceWorkflowId() {
  return "towbar-maintenance/v1";
}

export function notificationDeliveryWorkflowId(
  deliveryId: string,
  cycle: number,
) {
  return `towbar-notification-delivery/${deliveryId}/cycle/${cycle}`;
}

export function serverCoordinatorWorkflowId(canonicalIpHash: string) {
  return `towbar-server/v2/${canonicalIpHash}`;
}

export function sourceCoordinatorWorkflowId(sourceId: string) {
  return `towbar-source/${sourceId}`;
}
