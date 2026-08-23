export type AuthenticatedUser = {
  email: string;
  id: string;
  name: string;
  workspaceId: string;
  workspaceRole: "member" | "owner";
};

export type TowbarVariables = {
  currentSessionId: string;
  requestId: string;
  user: AuthenticatedUser;
};

export type TowbarHonoEnvironment = {
  Variables: TowbarVariables;
};
