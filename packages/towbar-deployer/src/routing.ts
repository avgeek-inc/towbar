import type { DeploymentExecutionContext } from "./types.js";

export function renderCaddyFragment(
  context: DeploymentExecutionContext,
  ports: number | number[],
) {
  const domains = context.app.domains;
  if (!domains) return "";

  const upstreams = (Array.isArray(ports) ? ports : [ports]).map(
    (port) => `127.0.0.1:${port}`,
  );
  const tunnel = context.app.ingress?.type === "cloudflare-tunnel";
  const site = (hostname: string) => (tunnel ? `http://${hostname}` : hostname);
  const lines = [
    `${site(domains.primary)} {`,
    `  reverse_proxy ${upstreams.join(" ")} {`,
    "    lb_policy round_robin",
    "  }",
    ...renderTransportHeaders(),
    ...renderTls(context),
    "}",
  ];
  for (const redirect of domains.redirects) {
    lines.push(
      `${site(redirect.host)} {`,
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
