import type { IncomingMessage, ServerResponse } from "node:http";
import type { LogDrainHealth, LogDrainProvider } from "@workspace/towbar-core";
import { fixtureJson } from "./fixture-localization.ts";

const configuredProviders = [
  "axiom",
  "betterstack",
  "datadog",
  "loki",
  "newrelic",
  "otlp",
] as const satisfies readonly LogDrainProvider[];

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
    if (pathname !== "/v1/core/log-drains") return false;
    const json = (body: unknown, status = 200) => {
      response.writeHead(status, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      response.end(fixtureJson(response, body));
      return true;
    };
    if (!options.canManage())
      return json(
        { error: { message: "Your role does not permit this action" } },
        403,
      );
    if (request.method !== "GET")
      return json({ error: { message: "Not found" } }, 404);

    const server = options.testServers()[0];
    const unhealthyStatus =
      options.testOutcome === "auth_failure"
        ? "auth_failure"
        : options.testOutcome === "rate_limited"
          ? "rate_limited"
          : null;
    return json({
      configurations: configuredProviders.map((provider) => ({
        provider,
        revision: `fixture-${provider}`,
        source: "environment",
        state: "enabled",
        health:
          server && unhealthyStatus
            ? [
                {
                  provider,
                  revision: `fixture-${provider}`,
                  status: unhealthyStatus,
                  serverId: server.id,
                  serverName: server.name,
                  rateLimitCount: unhealthyStatus === "rate_limited" ? 3 : 0,
                  failureCount: unhealthyStatus === "rate_limited" ? 3 : 1,
                  lastHttpStatus:
                    unhealthyStatus === "rate_limited" ? 429 : 401,
                  retryAt:
                    unhealthyStatus === "rate_limited"
                      ? new Date(Date.now() + 86_400_000).toISOString()
                      : null,
                  changedAt: new Date().toISOString(),
                  lastSuccessAt: null,
                  incidentId: "fixture-log-drain-incident",
                  acceptedBatches: 0,
                  droppedBatches: 0,
                } satisfies LogDrainHealth & {
                  serverId: string;
                  serverName: string;
                },
              ]
            : [],
      })),
    });
  };
}
