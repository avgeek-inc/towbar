export type SystemHealthStatus =
  "healthy" | "attention" | "critical" | "unknown";

export type SystemHealthCheck = {
  checkedAt: string | null;
  description: string;
  id:
    "api-database" | "aws" | "azure" | "gcp" | "github" | "temporal" | "worker";
  remediationHref: string | null;
  remediationLabel: string | null;
  status: SystemHealthStatus;
  title: string;
};

export type SystemHealth = {
  checkedAt: string;
  checks: SystemHealthCheck[];
  status: SystemHealthStatus;
  version: string;
};
