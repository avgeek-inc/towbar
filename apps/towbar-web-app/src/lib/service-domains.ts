import type { App } from "@workspace/towbar-web-client";

export type ServiceDomain = {
  hostname: string;
  role?: "Primary" | "Alternate";
  tls: "direct" | "cloudflare-dns" | "cloudflare-tunnel";
  target:
    | {
        kind: "service" | "compose";
        name: string;
        port: number;
        ingress: "proxy" | "cloudflare-tunnel";
      }
    | { kind: "redirect"; hostname: string; status: 301 | 302 };
};

function routeTls(
  ingress: "proxy" | "cloudflare-tunnel" | undefined,
  mode: "direct" | "cloudflare-dns" | undefined,
): ServiceDomain["tls"] {
  return ingress === "cloudflare-tunnel"
    ? "cloudflare-tunnel"
    : (mode ?? "direct");
}

export function getServiceDomains(config: App["config"]): ServiceDomain[] {
  if (config.kind === "compose")
    return Object.entries(config.services)
      .sort(([left], [right]) => left.localeCompare(right))
      .flatMap(([name, service]) =>
        (service.domains ?? []).map((hostname) => ({
          hostname,
          tls: routeTls(service.ingress?.type, service.tls?.mode),
          target: {
            kind: "compose" as const,
            name,
            // Manifest validation requires a port for every public Compose route.
            port: service.port!,
            ingress: service.ingress?.type ?? "proxy",
          },
        })),
      );
  const domains = config.domains;
  if (!domains) return [];
  const tls = routeTls(config.ingress?.type, config.tls?.mode);
  return [
    {
      hostname: domains.primary,
      role: "Primary",
      tls,
      target: {
        kind: "service",
        name: config.name,
        port: config.container.port,
        ingress: config.ingress?.type ?? "proxy",
      },
    },
    ...domains.redirects.map((redirect) => ({
      hostname: redirect.host,
      role: "Alternate" as const,
      tls,
      target: {
        kind: "redirect" as const,
        hostname: domains.primary,
        status: redirect.status,
      },
    })),
  ];
}
