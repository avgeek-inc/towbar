export type AuthenticatedUser = {
  email: string;
  id: string;
  name: string;
  workspaceId: string;
  workspaceRole: "member" | "owner";
};

export type TowbarVariables = {
  currentSessionId: string | null;
  apiKey:
    | { id: string; access: "read" | "write"; purpose: "api" | "mcp" | "both" }
    | undefined;
  requestId: string;
  user: AuthenticatedUser;
};

export type TowbarHonoEnvironment = {
  Variables: TowbarVariables;
};
