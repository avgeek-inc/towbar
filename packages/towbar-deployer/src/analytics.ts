import { isNormalizedApp } from "@workspace/towbar-core";
import type { DeploymentExecutionContext } from "./types.js";

export function renderAnalytics(context: DeploymentExecutionContext): string[] {
  if (
    context.environment === "preview" ||
    !isNormalizedApp(context.app) ||
    !context.app.analytics
  )
    return [];
  const id = context.deployableId;
  if (!/^[a-f0-9-]{36}$/u.test(id))
    throw new Error("Analytics requires a service UUID");
  return [
    "  log {",
    "    output net udp/127.0.0.1:9468 {",
    "      soft_start",
    "      dial_timeout 10ms",
    "    }",
    "    format filter {",
    "      wrap json",
    "      fields {",
    "        request delete",
    "        resp_headers delete",
    "        user_id delete",
    '        referrer regexp "(?s)^(?:https?://(?:[^/@]*@)?([A-Za-z0-9.:-]+)(?:[/?#].*)?|.*)$" "$1"',
    "      }",
    "    }",
    "  }",
    `  log_append service ${id}`,
    "  log_append path {http.request.uri.path}",
    "  log_append method {http.request.method}",
    "  log_append referrer {http.request.header.Referer}",
    ...(context.app.analytics.pageviews
      ? [
          "  handle /.well-known/towbar-analytics/* {",
          "    reverse_proxy 127.0.0.1:9469 {",
          `      header_up X-Towbar-Service ${id}`,
          "      header_up X-Towbar-Client-IP {http.request.remote.host}",
          "      header_up X-Towbar-CF-IP {http.request.header.CF-Connecting-IP}",
          "      header_up X-Towbar-CF-IPv6 {http.request.header.CF-Connecting-IPv6}",
          "    }",
          "  }",
        ]
      : []),
  ];
}
