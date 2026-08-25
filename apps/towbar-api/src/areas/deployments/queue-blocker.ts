export type DeploymentQueueBlocker =
  | "server_capacity"
  | "server_check"
  | "server_operation"
  | "server_preparation";

export type ServerQueueBarrier = {
  createdAt: Date;
  serverId: string;
  type: Exclude<DeploymentQueueBlocker, "server_capacity">;
};

export function resolveDeploymentQueueBlocker(input: {
  barriers: ServerQueueBarrier[];
  deployment: { createdAt: Date; serverId: string; state: string };
}): DeploymentQueueBlocker | null {
  if (input.deployment.state !== "queued") return null;
  const barrier = input.barriers
    .filter(
      (candidate) =>
        candidate.serverId === input.deployment.serverId &&
        candidate.createdAt.getTime() <= input.deployment.createdAt.getTime(),
    )
    .sort(
      (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
    )[0];
  return barrier?.type ?? "server_capacity";
}
