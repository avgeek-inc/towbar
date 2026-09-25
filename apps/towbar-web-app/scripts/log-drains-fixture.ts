import type { IncomingMessage, ServerResponse } from "node:http";
import type { LogDrainHealth, LogDrainProvider } from "@workspace/towbar-core";
import { fixtureJson } from "./fixture-localization.ts";

const configuredProviders = [
  "axiom",
  "betterstack",
  "datadog",
  "newrelic",
  "otlp",
] as const satisfies readonly LogDrainProvider[];

const publicSettings: Partial<
  Record<LogDrainProvider, Record<string, string | boolean>>
> = {
  newrelic: { region: "us", apiKeyConfigured: true },
  axiom: {
    dataset: "production",
    ingestHost: "us-east-1.aws.edge.axiom.co",
    apiKeyConfigured: true,
  },
  betterstack: {
    ingestHost: "in.logs.betterstack.com",
    apiKeyConfigured: true,
  },
  datadog: { site: "datadoghq.com", apiKeyConfigured: true },
  otlp: {
    endpoint: "https://collector.example.com/v1/logs",
    auth: "bearer",
    apiKeyConfigured: true,
  },
};

export function logDrainsFixture(options: {
  canManage: () => boolean;
  testOutcome?: "sent" | "auth_failure" | "rate_limited";
  testServers: () => { id: string; name: string }[];
}) {
  return async (
    request: IncomingMessage,
    response: ServerResponse,
    pathname: string,
  ) => {
    const usageServerId = pathname.match(
      /^\/v1\/core\/log-drains\/usage\/([0-9a-f-]{36})$/,
    )?.[1];
    if (pathname !== "/v1/core/log-drains" && !usageServerId) return false;
    const json = (body: unknown, status = 200) => {
      response.writeHead(status, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      response.end(fixtureJson(response, body));
      return true;
    };
    const servers = options.testServers();
    const server = servers[0];
    const unhealthyStatus =
      options.testOutcome === "auth_failure"
        ? "auth_failure"
        : options.testOutcome === "rate_limited"
          ? "rate_limited"
          : null;
    const health = (provider: LogDrainProvider) =>
      ({
        provider,
        revision: `fixture-${provider}`,
        status: unhealthyStatus ?? "configured",
        rateLimitCount: unhealthyStatus === "rate_limited" ? 3 : 0,
        failureCount: unhealthyStatus ? 3 : 0,
        lastHttpStatus:
          unhealthyStatus === "rate_limited"
            ? 429
            : unhealthyStatus
              ? 401
              : 200,
        retryAt:
          unhealthyStatus === "rate_limited"
            ? new Date(Date.now() + 86_400_000).toISOString()
            : null,
        changedAt: new Date().toISOString(),
        lastSuccessAt: unhealthyStatus ? null : new Date().toISOString(),
        incidentId: null,
        acceptedBatches: unhealthyStatus ? 0 : 120,
        droppedBatches: unhealthyStatus === "auth_failure" ? 3 : 0,
      }) satisfies LogDrainHealth;
    if (usageServerId) {
      if (request.method !== "GET")
        return json({ error: { message: "Not found" } }, 404);
      if (!servers.some((item) => item.id === usageServerId))
        return json({ error: { message: "Server was not found" } }, 404);
      return json({
        checkedAt: new Date().toISOString(),
        providers: configuredProviders.map((provider) => ({
          provider,
          health: health(provider),
        })),
      });
    }
    if (!options.canManage())
      return json(
        { error: { message: "Your role does not permit this action" } },
        403,
      );
    if (request.method !== "GET")
      return json({ error: { message: "Not found" } }, 404);

    return json({
      configurations: configuredProviders.map((provider) => ({
        provider,
        ...publicSettings[provider],
        revision: `fixture-${provider}`,
        source: "environment",
        state: "enabled",
        health: server
          ? [
              {
                ...health(provider),
                serverId: server.id,
                serverName: server.name,
                checkedAt: new Date().toISOString(),
              },
            ]
          : [],
      })),
    });
  };
}
