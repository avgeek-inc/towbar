import type { DeploymentExecutionContext } from "./types.js";

export function renderCaddyFragment(
  context: DeploymentExecutionContext,
  port: number,
) {
  const domains = context.app.domains;
  if (!domains) return "";

  const lines = [
    `${domains.primary} {`,
    `  reverse_proxy 127.0.0.1:${port}`,
    ...renderTransportHeaders(),
    ...renderTls(context),
    "}",
  ];
  for (const redirect of domains.redirects) {
    lines.push(
      `${redirect.host} {`,
      `  redir https://${domains.primary}{uri} ${redirect.status}`,
      ...renderTransportHeaders(),
      ...renderTls(context),
      "}",
    );
  }
  return `${lines.join("\n")}\n`;
}

function renderTransportHeaders() {
  return ['  header ?Strict-Transport-Security "max-age=15552000"'];
}

function renderTls(context: DeploymentExecutionContext) {
  return context.app.tls?.mode === "cloudflare-dns"
    ? ["  tls {", "    dns cloudflare {env.CLOUDFLARE_API_TOKEN}", "  }"]
    : [];
}
