import type {
  NormalizedComposeWorkload,
  NormalizedDeployable,
} from "./manifest.js";

export function deploymentCloudflareDnsDomains(
  app: Pick<NormalizedDeployable, "domains" | "ingress" | "tls"> & {
    services?: NormalizedComposeWorkload["services"];
  },
): string[] {
  if (app.services)
    return Object.values(app.services).flatMap((service) =>
      service.tls?.mode === "cloudflare-dns" &&
      service.ingress?.type !== "cloudflare-tunnel"
        ? (service.domains ?? [])
        : [],
    );
  return app.tls?.mode === "cloudflare-dns" &&
    app.ingress?.type !== "cloudflare-tunnel" &&
    app.domains
    ? [app.domains.primary, ...app.domains.redirects.map(({ host }) => host)]
    : [];
}
