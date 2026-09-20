import type { LogDrainProvider } from "@workspace/towbar-core";

export const logDrainNames = {
  newrelic: "New Relic",
  axiom: "Axiom",
  betterstack: "Better Stack",
  datadog: "Datadog",
  otlp: "OpenTelemetry (OTLP)",
  loki: "Grafana Cloud / Loki",
} satisfies Record<LogDrainProvider, string>;

type Field = {
  name: string;
  label: string;
  placeholder?: string;
  description?: string;
  optional?: boolean;
  type?: "url";
  options?: { id: string; label: string }[];
};
const regions = [
  { id: "us", label: "United States" },
  { id: "eu", label: "Europe" },
];
export const logDrainFields: Record<LogDrainProvider, Field[]> = {
  newrelic: [
    {
      name: "region",
      label: "Region",
      options: [...regions, { id: "jp", label: "Japan" }],
    },
  ],
  axiom: [
    {
      name: "ingestHost",
      label: "Ingestion host",
      placeholder: "us-east-1.aws.edge.axiom.co",
    },
    { name: "dataset", label: "Dataset", placeholder: "production" },
  ],
  betterstack: [
    {
      name: "ingestHost",
      label: "Ingestion host",
      placeholder: "s123456.eu-nbg-2.betterstackdata.com",
    },
  ],
  datadog: [
    {
      name: "site",
      label: "Site",
      options: [
        "datadoghq.com",
        "us3.datadoghq.com",
        "us5.datadoghq.com",
        "datadoghq.eu",
        "ap1.datadoghq.com",
        "ap2.datadoghq.com",
        "us2.ddog-gov.com",
        "ddog-gov.com",
        "uk1.datadoghq.com",
      ].map((id) => ({ id, label: id })),
    },
  ],
  otlp: [
    {
      name: "endpoint",
      label: "Logs endpoint URL",
      type: "url",
      placeholder: "https://collector.example.com/v1/logs",
      description:
        "Enter the full OTLP/HTTP logs endpoint, including its path.",
    },
  ],
  loki: [
    {
      name: "endpoint",
      label: "Loki push URL",
      type: "url",
      placeholder: "https://logs.example.com/loki/api/v1/push",
      description:
        "Use the push URL from Grafana Cloud, or your own Loki endpoint.",
    },
    {
      name: "tenantId",
      label: "Tenant ID",
      optional: true,
      placeholder: "Leave empty unless required",
    },
  ],
};

export const logDrainDefaults: Record<
  LogDrainProvider,
  Record<string, string>
> = {
  newrelic: { region: "us" },
  axiom: { ingestHost: "us-east-1.aws.edge.axiom.co", dataset: "" },
  betterstack: { ingestHost: "" },
  datadog: { site: "datadoghq.com" },
  otlp: { endpoint: "", auth: "bearer", username: "", caCertificate: "" },
  loki: {
    endpoint: "",
    auth: "basic",
    username: "",
    tenantId: "",
    caCertificate: "",
  },
};

export function logDrainStatus(configuration?: {
  state?: string;
  health?: { status: string; retryAt: string | null }[];
}) {
  if (!configuration) return { status: "pending", label: "Not configured" };
  if (configuration.state === "paused")
    return { status: "pending", label: "Paused after restore" };
  if (configuration.health?.some((item) => item.status === "auth_failure"))
    return { status: "failed", label: "Auth failure" };
  if (configuration.health?.some((item) => item.status === "rate_limited"))
    return { status: "warning", label: "Rate limited" };
  if (configuration.health?.some((item) => item.status === "retrying"))
    return { status: "retrying", label: "Retrying" };
  return { status: "configured", label: "Configured" };
}
