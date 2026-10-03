import type { NormalizedDeployable } from "./manifest.js";

export function deploymentPublicHostnames(app: NormalizedDeployable) {
  const hostnames =
    app.kind === "compose"
      ? Object.values(app.services).flatMap((service) => service.domains ?? [])
      : app.domains
        ? [
            app.domains.primary,
            ...app.domains.redirects.map((redirect) => redirect.host),
          ]
        : [];
  return [
    ...new Set(
      hostnames.map((hostname) => hostname.toLowerCase().replace(/\.$/, "")),
    ),
  ].sort();
}

export type DomainHandoff = {
  hostname: string;
  previousAppId: string;
  previousAppName: string;
  previousServerId: string;
  previousServerIp: string;
  previousDeploymentId: string;
  previousManagedDns: boolean;
};

export function deploymentTunnelHostnames(app: NormalizedDeployable) {
  return app.kind === "compose"
    ? Object.values(app.services)
        .filter((service) => service.ingress?.type === "cloudflare-tunnel")
        .flatMap((service) => service.domains ?? [])
    : app.ingress?.type === "cloudflare-tunnel"
      ? deploymentPublicHostnames(app)
      : [];
}
