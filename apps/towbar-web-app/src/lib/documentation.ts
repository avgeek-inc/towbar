import type {
  HeadingDocumentation,
  HeadingKind,
} from "@workspace/web-design-system/overlays/heading-help";

const docsOrigin = "https://www.towbar.dev";
function guide(path: string, description: string): HeadingDocumentation {
  return {
    href: `${docsOrigin}/docs${path.startsWith("#") ? "" : "/"}${path}`,
    description,
  };
}

export const documentationTopics = {
  auditLogs: guide(
    "team-settings#audit-logs",
    "Browse captured team activity by event and user. Open an event to inspect its target, attribution, and metadata.",
  ),
  deliveries: guide(
    "integrations/notifications#delivery-history",
    "Review notification delivery status across providers, including attempts, errors, and retry times.",
  ),
  logDrains: guide(
    "integrations/log-drains",
    "Enable log forwarding in the Towbar environment, then select destinations in app and resource manifests.",
  ),
  overview: guide(
    "#start-with-the-overview",
    "Check workload health, recent deployments, server capacity, and incidents across your team.",
  ),
  repositories: guide(
    "repositories",
    "Connect GitHub repositories, map environments to branches, and sync the apps and resources declared in Git.",
  ),
  sync: guide(
    "repositories#change-configuration",
    "Review the commit, imported inventory, changes, and validation issues from one repository sync.",
  ),
  apps: guide(
    "apps",
    "Apps build a Dockerfile from your repository and run on a prepared server. Choose an environment to view its current state.",
  ),
  resources: guide(
    "resources",
    "Resources run container images, including managed PostgreSQL and Redis databases, on your servers.",
  ),
  deployments: guide(
    "deployments",
    "A deployment records one attempt to build or pull an image, check its health, and put it into service.",
  ),
  progress: guide(
    "deployments#read-the-final-result",
    "Follow recorded deployment stages and their duration. A queued request is still waiting to run.",
  ),
  logs: guide(
    "troubleshooting#collect-useful-diagnostics",
    "Read captured output for this operation or workload. Logs can help explain build, startup, and health-check failures.",
  ),
  previews: guide(
    "previews",
    "Run isolated app instances for eligible pull requests, with separate preview secrets and automatic cleanup.",
  ),
  servers: guide(
    "servers",
    "Register an Ubuntu server, configure trusted SSH access, and prepare it to run apps and resources.",
  ),
  preparation: guide(
    "servers#prepare-the-runtime",
    "Follow connection checks and prerequisite installation. Expand a step for its details and duration.",
  ),
  credentials: guide(
    "servers#register-and-trust-the-host",
    "Choose a stored SSH key, verify the connection, and trust the server's host fingerprint before preparation.",
  ),
  capacity: guide(
    "servers#read-capacity-and-health",
    "Compare current CPU, memory, and disk use with the server's capacity. Missing measurements do not mean zero usage.",
  ),
  cleanup: guide(
    "servers#clean-up-leftover-workloads",
    "Review containers, images, and volumes left behind on this server before choosing what to remove.",
  ),
  removal: guide(
    "servers#remove-a-server",
    "Remove this server from Towbar after reviewing affected workloads and any data you need to keep.",
  ),
  tls: guide(
    "domains-tls#cloudflare-tls",
    "Enable Cloudflare TLS for this server after its runtime integration has been configured in the Towbar environment.",
  ),
  performance: guide(
    "monitoring#performance-history",
    "Review Scout measurements over a selected time range. Gaps mean no sample was recorded.",
  ),
  scout: guide(
    "scout",
    "Scout Agent collects server and workload measurements for performance charts, alerts, and deployment comparisons.",
  ),
  alerts: guide(
    "scout-alerts#create-a-rule",
    "Choose a metric, threshold, and severity. Towbar opens an incident when a fresh reading meets the rule.",
  ),
  incidents: guide(
    "scout-alerts#inspect-an-incident",
    "Investigate a triggered alert, its measurements, resolution, and notification delivery history.",
  ),
  comparison: guide(
    "deployment-comparisons",
    "Compare resource use during equal observation windows after two deployments become ready.",
  ),
  vulnerabilities: guide(
    "vulnerability-scanning",
    "Inspect image findings by severity and package. Scan status is separate from deployment success and runtime health.",
  ),
  backups: guide(
    "backups",
    "Review backup schedules, storage destinations, and saved recovery points for PostgreSQL and Redis.",
  ),
  restores: guide(
    "restores",
    "Choose a compatible backup and review the restore plan before replacing database contents.",
  ),
  secrets: guide(
    "secrets",
    "Set declared build, runtime, and hook secrets. Values stay masked unless your role permits revealing them.",
  ),
  automation: guide(
    "repositories#control-automatic-deployment",
    "Pause or enable automatic work for this environment. Syncing configuration and deploying are separate actions.",
  ),
  manifest: guide(
    "deployment-manifest",
    "Git stores workload configuration. The dashboard shows the last successfully synced manifest for this environment.",
  ),
  github: guide(
    "integrations/github",
    "Configure the GitHub App in the Towbar environment, install it on the intended account, and grant repository access.",
  ),
  gitlab: guide(
    "integrations/gitlab",
    "Configure the GitLab OAuth application in the Towbar environment, then authorize the account Towbar should use.",
  ),
  registry: guide(
    "integrations/oci-registry",
    "Configure one OCI registry in the Towbar environment for private images and build transfers.",
  ),
  externalSecrets: guide(
    "integrations/external-secrets",
    "Reference secrets from an environment-configured Infisical or Doppler provider without storing their values in manifests.",
  ),
  cloudflare: guide(
    "integrations/platform-services#cloudflare",
    "Configure Cloudflare in the Towbar environment for DNS operations, tunnel ingress, and Cloudflare TLS.",
  ),
  otlp: guide(
    "integrations/platform-services#opentelemetry",
    "Export workload telemetry through the OpenTelemetry integration configured in the Towbar environment.",
  ),
  aws: guide(
    "integrations/aws",
    "Enable AWS credentials in the Towbar environment for database backups in S3.",
  ),
  gcp: guide(
    "integrations/gcp",
    "Enable a service account in the Towbar environment for Cloud Storage backups and restores.",
  ),
  azure: guide(
    "integrations/azure",
    "Enable Azure Blob Storage in the Towbar environment for backup and restore files.",
  ),
  s3Compatible: guide(
    "integrations/s3-compatible",
    "Configure S3-compatible storage or Cloudflare R2 in the Towbar environment for backups and restores.",
  ),
  notifications: guide(
    "integrations/notifications",
    "Review the providers and category routes enabled by the Towbar runtime environment.",
  ),
  slack: guide(
    "integrations/notifications#configure-slack",
    "Configure a Slack bot token and category channel routes in the Towbar runtime environment.",
  ),
  email: guide(
    "integrations/notifications#configure-email",
    "Configure SMTP delivery and recipient routes in the Towbar runtime environment.",
  ),
  discord: guide(
    "integrations/notifications#configure-discord",
    "Configure a Discord incoming webhook route for each required notification category.",
  ),
  telegram: guide(
    "integrations/notifications#configure-telegram",
    "Configure the Telegram bot, chat, and optional topic routes in the Towbar runtime environment.",
  ),
  webhook: guide(
    "integrations/notifications#configure-webhook-push",
    "Send event JSON to the public HTTPS webhook route configured for each category.",
  ),
  system: guide(
    "monitoring#system-health",
    "Check Towbar's API, database, workflow engine, and worker. These checks are separate from workload health.",
  ),
  keys: guide(
    "ssh-keys",
    "Generate or store SSH private keys once, then select them in server credentials. Only admins can manage these keys.",
  ),
  team: guide(
    "team-settings",
    "Admins manage the team name, members, invitations, and team-owned API keys here.",
  ),
  members: guide(
    "team-settings#members",
    "Add users, invite people by email, and manage Admin, Member, or Viewer access.",
  ),
  profile: guide(
    "personal-settings#profile",
    "Update the display name shown for your account in the sidebar and member list.",
  ),
  preferences: guide(
    "personal-settings#preferences",
    "Choose how Towbar displays dates and times, and the time zone used for your account and personal API keys.",
  ),
  emailPassword: guide(
    "personal-settings#email-and-password",
    "Confirm a new sign-in email address or change your password. Save each form separately.",
  ),
  repositoryRemoval: guide(
    "repositories#delete-a-repository",
    "Remove this repository and its imported inventory from Towbar. Running services and Docker data require separate cleanup.",
  ),
  sessions: guide(
    "personal-settings#sessions",
    "Review active browser sessions and revoke sessions you no longer recognize or need.",
  ),
  security: guide(
    "personal-settings#two-factor-auth",
    "Set up an authenticator app, save recovery codes, and manage passkeys for your account.",
  ),
  apiKeys: guide(
    "api/authentication#keys-and-permissions",
    "Create a personal or team key with limited access and an expiry. Copy the token once when it is created.",
  ),
  mcp: guide(
    "api/mcp",
    "Connect an MCP client using a personal API key. Its tools follow the same permissions as the REST API.",
  ),
} satisfies Record<string, HeadingDocumentation>;

type Topic = keyof typeof documentationTopics;

const integrationDocumentationTopics: Record<string, Topic> = {
  axiom: "logDrains",
  aws: "aws",
  azure: "azure",
  betterstack: "logDrains",
  cloudflare: "cloudflare",
  datadog: "logDrains",
  discord: "discord",
  doppler: "externalSecrets",
  email: "email",
  gcp: "gcp",
  github: "github",
  gitlab: "gitlab",
  infisical: "externalSecrets",
  loki: "logDrains",
  newrelic: "logDrains",
  otlp: "logDrains",
  "otlp-platform": "otlp",
  r2: "s3Compatible",
  registry: "registry",
  s3: "s3Compatible",
  slack: "slack",
  telegram: "telegram",
  webhook: "webhook",
};

function integrationDocumentationTopic(path: string) {
  const provider = path.split("/").at(-1);
  return integrationDocumentationTopics[provider ?? ""] ?? "github";
}

export function documentationTopic(pathname: string): Topic | undefined {
  const path = pathname.replace(/\/$/, "") || "/";
  if (path === "/") return "overview";
  if (path === "/team-settings/audit-logs") return "auditLogs";
  if (
    path === "/manage/notifications/deliveries" ||
    path === "/manage/integrations/deliveries" ||
    path === "/team-settings/integrations/deliveries"
  )
    return "deliveries";
  if (/\/deployments\/[^/]+/.test(path)) {
    if (path.endsWith("/vulnerabilities")) return "vulnerabilities";
    if (path.endsWith("/logs")) return "logs";
    if (path.endsWith("/progress")) return "progress";
    return "deployments";
  }
  if (/\/syncs\/[^/]+/.test(path)) return "sync";
  if (path === "/team-settings/ssh-keys") return "keys";
  if (path === "/team-settings/shared-secrets") return "secrets";
  if (path.startsWith("/team-settings/integrations"))
    return integrationDocumentationTopic(path);
  if (path.startsWith("/team-settings"))
    return path.endsWith("/api-keys")
      ? "apiKeys"
      : path.endsWith("/members")
        ? "members"
        : "team";
  if (path.startsWith("/settings") || path.startsWith("/account/")) {
    if (path.endsWith("/preferences")) return "preferences";
    if (path.endsWith("/api-keys")) return "apiKeys";
    if (path.endsWith("/mcp")) return "mcp";
    if (path.endsWith("/email-password")) return "emailPassword";
    if (path.endsWith("/sessions")) return "sessions";
    if (/\/(2fa|security)$/.test(path)) return "security";
    return "profile";
  }
  if (path === "/manage/private-keys") return "keys";
  if (path === "/manage/shared-secrets") return "secrets";
  if (path.startsWith("/manage/notifications")) {
    const provider = path.split("/")[3];
    return ["slack", "email", "discord", "telegram", "webhook"].includes(
      provider ?? "",
    )
      ? (provider as Topic)
      : "notifications";
  }
  if (path.startsWith("/manage/log-forwarding")) return "logDrains";
  if (path.startsWith("/manage/integrations"))
    return integrationDocumentationTopic(path);
  if (path.startsWith("/repositories/") && /\/(danger|danger-zone)$/.test(path))
    return "repositoryRemoval";
  if (path === "/system-health") return "system";
  if (path === "/deployments") return "deployments";
  const parts = path.split("/").filter(Boolean);
  const section = parts.at(-1);
  const sections: Record<string, Topic> = {
    performance: "performance",
    alerts: "alerts",
    incidents: "incidents",
    comparison: "comparison",
    "compare-deployments": "comparison",
    vulnerabilities: "vulnerabilities",
    previews: "previews",
    deployments: "deployments",
    logs: "logs",
    secrets: "secrets",
    "shared-secrets": "secrets",
    "auto-deploy": "automation",
    manifest: "manifest",
    "sync-history": "sync",
    notifications: "notifications",
    credentials: "credentials",
    "cloudflare-tls": "tls",
    "scout-agent": "scout",
    "monitoring-agent": "scout",
    monitoring: "scout",
    checks: "capacity",
    cleanup: "cleanup",
    "danger-zone": "removal",
    danger: "removal",
    preparation: "preparation",
    backup: "backups",
    restore: "restores",
  };
  if (section && sections[section]) return sections[section];
  if (parts.includes("apps")) return "apps";
  if (parts.includes("resources")) return "resources";
  if (parts[0] === "servers") return "servers";
  if (parts[0] === "repositories") return "repositories";
  return undefined;
}

export const widgetDocumentation: Record<string, HeadingDocumentation> = {
  "server setup": documentationTopics.preparation,
  "server inspection": guide(
    "servers#prepare-the-runtime",
    "Check SSH access and inspect the operating system and permissions before installing services.",
  ),
  prerequisites: guide(
    "servers#prepare-the-runtime",
    "Install or validate system packages, Docker, Caddy, deployment access, and the final server checks.",
  ),
  "host capacity": documentationTopics.capacity,
  "server credentials": documentationTopics.credentials,
  connection: guide(
    "servers#register-and-trust-the-host",
    "View this server's SSH address, port, user, and provider details.",
  ),
  operations: guide(
    "servers#read-capacity-and-health",
    "Review setup readiness, the latest server check, installed software, and build concurrency limits.",
  ),
  "connection and capacity": guide(
    "servers#set-concurrency",
    "Update the SSH connection and the maximum number of simultaneous builds on this server.",
  ),
  "server identity and capacity": documentationTopics.servers,
  "cloudflare tls": documentationTopics.tls,
  "scout agent": documentationTopics.scout,
  performance: documentationTopics.performance,
  "cpu usage": guide(
    "monitoring#performance-history",
    "CPU consumption over the selected time range. Compare the measurement with the workload's allocation or host capacity.",
  ),
  "memory usage": guide(
    "monitoring#performance-history",
    "Recorded memory consumption over the selected time range. The chart's axis shows whether values are bytes or percentages.",
  ),
  "memory used": documentationTopics.performance,
  "docker disk usage": documentationTopics.performance,
  "swap used": documentationTopics.performance,
  "load average (5 minutes)": documentationTopics.performance,
  "load average (15 minutes)": documentationTopics.performance,
  "network received": documentationTopics.performance,
  "network sent": documentationTopics.performance,
  "disk read": documentationTopics.performance,
  "disk written": documentationTopics.performance,
  "block read": documentationTopics.performance,
  "block written": documentationTopics.performance,
  "container restarts": documentationTopics.incidents,
  "no scout report for": documentationTopics.alerts,
  "public http endpoint": guide(
    "scout-alerts#public-http-checks",
    "Check a public HTTP endpoint from the control plane. These checks do not need an installed Scout Agent.",
  ),
  "root disk usage": guide(
    "scout-alerts#measurements-and-incident-states",
    "The percentage of the server's root disk in use. Incident charts show the alert threshold alongside the readings.",
  ),
  "network traffic": guide(
    "monitoring#performance-history",
    "Network receive and transmit rates over the selected time range.",
  ),
  "disk i/o": guide(
    "monitoring#performance-history",
    "Disk read and write rates reported by Scout Agent.",
  ),
  "incident details": documentationTopics.incidents,
  "active incidents": documentationTopics.incidents,
  "deployments trend": guide(
    "#start-with-the-overview",
    "Daily deployment requests, successes, and failures, with the recent success rate and duration summary.",
  ),
  "deployment queue": guide(
    "deployments#browse-deployment-history",
    "Requests that are queued or running. Open a deployment to follow its progress.",
  ),
  notifications: guide(
    "integrations/notifications#diagnose-delivery",
    "Review operational notifications. Opening an event takes you to the affected workload or incident.",
  ),
  "last deployment attempt": guide(
    "deployments#read-the-final-result",
    "The most recent deployment attempt can differ from the release that is currently serving traffic.",
  ),
  "auto-deploy": documentationTopics.automation,
  "environment automation": documentationTopics.automation,
  "preview configuration": documentationTopics.previews,
  "build configuration": guide(
    "apps#supply-configuration",
    "The Dockerfile, build context, source revision, and build settings read from the app manifest.",
  ),
  "image configuration": guide(
    "resources#supported-types",
    "The container image, resource type, and source configuration selected for this resource.",
  ),
  "container configuration": guide(
    "deployment-manifest#field-reference",
    "Ports, network, CPU, memory, and storage settings declared for the container.",
  ),
  "deployment configuration": guide(
    "deployments#deployment-hooks",
    "Health checks and deployment hooks control when a candidate is ready and which commands run around promotion.",
  ),
  "connection details": guide(
    "resources#connect-privately",
    "Use the container network for private workload traffic or an SSH tunnel for local database access.",
  ),
  deployment: documentationTopics.deployments,
  target: guide(
    "deployments#read-the-final-result",
    "The workload, environment, commit, and image recorded for this deployment attempt.",
  ),
  "pull request": documentationTopics.previews,
  progress: documentationTopics.progress,
  sync: documentationTopics.sync,
  revision: guide(
    "repositories#change-configuration",
    "The commit and manifest identity read during this sync. They identify the exact configuration that was imported.",
  ),
  "imported inventory": documentationTopics.sync,
  "restore progress": documentationTopics.restores,
  "aws credentials": documentationTopics.aws,
  "google cloud credentials": documentationTopics.gcp,
  "azure credentials": documentationTopics.azure,
  "restore source": documentationTopics.restores,
  "latest log capture": documentationTopics.logs,
  "github app": documentationTopics.github,
  "github app configuration": documentationTopics.github,
  "github connection": guide(
    "integrations/github#verify-access",
    "The GitHub account and installation that grant Towbar access to selected repositories.",
  ),
  "control plane": documentationTopics.system,
  integrations: guide(
    "monitoring#system-health",
    "Connection checks for the external providers configured in this Towbar installation.",
  ),
  "team details": guide(
    "team-settings#general",
    "Set the team name shown in the sidebar and an optional description for the workspace.",
  ),
  appearance: guide(
    "personal-settings#profile",
    "Change your display name and open Gravatar to edit the image associated with your email.",
  ),
  "email address": guide(
    "personal-settings#change-your-email",
    "Confirm a link sent to the new address before it replaces your sign-in email.",
  ),
  "change password": guide(
    "personal-settings#change-your-password",
    "Use your current password to set a new one with at least 15 characters.",
  ),
  "authenticator app": guide(
    "personal-settings#two-factor-auth",
    "Add a one-time authenticator code to password sign-in and keep recovery codes for a lost device.",
  ),
  passkeys: guide(
    "personal-settings#passkeys",
    "Sign in using a device or password manager, with its PIN, fingerprint, or face verification.",
  ),
  "connect your mcp client": documentationTopics.mcp,
};

export function headingDocumentation(
  pathname: string,
  title: string,
  kind: HeadingKind,
): HeadingDocumentation | undefined {
  const topic = documentationTopic(pathname);
  if (!topic) return undefined;
  if (kind === "page") return documentationTopics[topic];
  const name = title.trim().toLowerCase();
  if (
    name === "connection details" &&
    pathname.includes("/integrations/github")
  )
    return documentationTopics.github;
  if (topic === "comparison" && /cpu|memory|network|block|disk/i.test(name))
    return documentationTopics.comparison;
  if (name.includes("backup")) return documentationTopics.backups;
  if (["disk usage", "load average (1 minute)", "block i/o"].includes(name))
    return documentationTopics.performance;
  if (name.endsWith("secrets")) return documentationTopics.secrets;
  if (
    [
      "credentials",
      "channels",
      "configuration",
      "categories",
      "topics",
    ].includes(name) &&
    (pathname.startsWith("/manage/notifications") ||
      pathname.startsWith("/manage/integrations") ||
      pathname.startsWith("/team-settings/integrations"))
  )
    return documentationTopics[topic];
  if (name === "current state")
    return guide(
      topic === "resources" ? "resources" : "apps",
      "Lifecycle, runtime health, and configuration drift describe different parts of this workload's state. Check each before deploying.",
    );
  if (name === "danger zone")
    return pathname.startsWith("/repositories")
      ? guide(
          "repositories#delete-a-repository",
          "Delete this repository's inventory and history from Towbar. Running containers and data need a separate cleanup.",
        )
      : documentationTopics.removal;
  if (
    /^(aws s3|google cloud storage|azure blob storage) configuration$/.test(
      name,
    )
  )
    return documentationTopics.backups;
  if (["critical", "high", "medium", "low", "unknown"].includes(name))
    return documentationTopics.vulnerabilities;
  if (["apps", "resources", "servers"].includes(name))
    return documentationTopics[name as "apps" | "resources" | "servers"];
  return widgetDocumentation[name];
}
