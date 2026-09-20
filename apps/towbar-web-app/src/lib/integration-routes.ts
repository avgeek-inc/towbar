import { logDrainNames } from "./log-drain-providers";

export const logForwardingRoutes = Object.keys(logDrainNames);

export const notificationRoutes = [
  "slack",
  "email",
  "discord",
  "telegram",
  "webhook",
  "deliveries",
] as const;

const platformIntegrationRoutes = [
  "github",
  "gitlab",
  "registry",
  "aws",
  "gcp",
  "azure",
  "s3",
  "r2",
  "infisical",
  "doppler",
  "cloudflare",
  "otlp-platform",
] as const;

export const integrationRoutes = [
  ...platformIntegrationRoutes,
  ...logForwardingRoutes,
  ...notificationRoutes,
];

const integrationRouteSet = new Set<string>(integrationRoutes);
const logForwardingRouteSet = new Set<string>(logForwardingRoutes);

export function isIntegrationRoute(value: string | undefined): value is string {
  return value !== undefined && integrationRouteSet.has(value);
}

export function isLogForwardingRoute(
  value: string | undefined,
): value is string {
  return value !== undefined && logForwardingRouteSet.has(value);
}
