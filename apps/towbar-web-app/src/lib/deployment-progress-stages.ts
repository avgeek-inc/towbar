import type {
  Deployment,
  DeploymentState,
  DeploymentStep,
} from "@workspace/towbar-web-client";

const stages: { id: string; title: string; states: DeploymentState[] }[] = [
  {
    id: "validating",
    title: "Validating setup",
    states: ["preparing", "validating_credentials", "checking_server"],
  },
  {
    id: "preparing",
    title: "Preparing artifacts",
    states: [
      "fetching_source",
      "resolving_secrets",
      "transferring",
      "building",
    ],
  },
  {
    id: "deploying",
    title: "Deploying artifacts",
    states: [
      "running_pre_deploy",
      "starting_candidate",
      "checking_health",
      "configuring_routing",
      "provisioning_tls",
      "checking_public_endpoint",
      "switching_traffic",
    ],
  },
  {
    id: "finishing",
    title: "Finishing up",
    states: ["running_post_deploy", "cleaning_up"],
  },
];

type ProgressStatus = DeploymentStep["status"] | "cancelled";
export type ProgressStep = Omit<DeploymentStep, "status"> & {
  status: ProgressStatus;
};

export function deploymentProgressStages(
  deployment: Pick<Deployment, "state" | "finishedAt">,
  steps: DeploymentStep[],
) {
  const terminalStatus: ProgressStatus | undefined =
    deployment.state === "succeeded_with_warnings"
      ? "succeeded"
      : ["succeeded", "failed", "cancelled", "skipped"].includes(
            deployment.state,
          )
        ? (deployment.state as ProgressStatus)
        : undefined;
  const normalized: ProgressStep[] = steps
    .map((step) => ({
      ...step,
      status:
        step.status === "running"
          ? (terminalStatus ?? step.status)
          : step.status,
      finishedAt:
        step.finishedAt ??
        (step.status === "running" ? deployment.finishedAt : null),
    }))
    .sort((left, right) => left.sequence - right.sequence);

  return stages.map((stage, index) => {
    const work = normalized.filter((step) => stage.states.includes(step.state));
    const members =
      index === 0
        ? normalized.filter(
            (step) =>
              stage.states.includes(step.state) ||
              step.state === "queued" ||
              step.state === "waiting_for_server",
          )
        : work;
    let status: ProgressStatus;
    if (work.some((step) => step.status === "failed")) status = "failed";
    else if (work.some((step) => step.status === "cancelled"))
      status = "cancelled";
    else if (!terminalStatus && stage.states.includes(deployment.state))
      status = "running";
    else if (work.some((step) => step.status === "running")) status = "running";
    else if (!work.length || work.some((step) => step.status === "waiting"))
      status = "waiting";
    else if (work.every((step) => step.status === "skipped"))
      status = "skipped";
    else status = "succeeded";

    return {
      id: stage.id,
      title: stage.title,
      status,
      startedAt: work.find((step) => step.startedAt)?.startedAt ?? null,
      finishedAt:
        status === "running" || status === "waiting"
          ? null
          : ([...work].reverse().find((step) => step.finishedAt)?.finishedAt ??
            null),
      steps: members,
    };
  });
}
