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

export const previewBranchEventSchema = z
  .object({
    branch: z.string().min(1).max(255),
    commitSha: z
      .string()
      .regex(/^[a-f0-9]{40}$/u)
      .nullable(),
    deleted: z.boolean(),
    sourceId: z.string().uuid(),
  })
  .strict()
  .superRefine((event, context) => {
    if (event.deleted !== (event.commitSha === null)) {
      context.addIssue({
        code: "custom",
        message: "Deleted Preview events must omit the commit SHA",
      });
    }
  });

export type PreviewBranchEvent = z.infer<typeof previewBranchEventSchema>;

export function deploymentWorkflowId(deploymentId: string) {
  return `towbar-deployment/${deploymentId}`;
}

export function resourceOperationWorkflowId(operationId: string) {
  return `towbar-resource-operation/${operationId}`;
}

export function maintenanceWorkflowId() {
  return "towbar-maintenance/v1";
}

export function serverCoordinatorWorkflowId(canonicalIpHash: string) {
  return `towbar-server/v2/${canonicalIpHash}`;
}

export function sourceCoordinatorWorkflowId(sourceId: string) {
  return `towbar-source/${sourceId}`;
}
