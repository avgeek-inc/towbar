export const serverPreparationStepDefinitions = [
  {
    id: "connecting",
    title: "Connect securely",
  },
  {
    id: "inspecting",
    title: "Inspect server",
  },
  {
    id: "installing_prerequisites",
    title: "Install prerequisites",
  },
  {
    id: "installing_docker",
    title: "Install Docker Engine",
  },
  {
    id: "installing_caddy",
    title: "Install Caddy",
  },
  {
    id: "configuring_access",
    title: "Configure access",
  },
  {
    id: "verifying",
    title: "Verify server",
  },
] as const;

export type ServerPreparationStepId =
  (typeof serverPreparationStepDefinitions)[number]["id"];

export type ServerPreparationStepStatus =
  "waiting" | "running" | "succeeded" | "failed";

export type ServerPreparationStep = {
  finishedAt: string | null;
  id: ServerPreparationStepId;
  message: string | null;
  startedAt: string | null;
  status: ServerPreparationStepStatus;
  title: string;
};

export function createServerPreparationSteps(): ServerPreparationStep[] {
  return serverPreparationStepDefinitions.map((step) => ({
    ...step,
    finishedAt: null,
    message: null,
    startedAt: null,
    status: "waiting",
  }));
}
