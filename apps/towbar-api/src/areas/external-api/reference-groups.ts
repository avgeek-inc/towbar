export const referenceCategories = [
  "Sources",
  "Apps",
  "Resources",
  "Servers",
  "Deployments",
  "Previews",
  "Workspace",
  "Integrations",
] as const;

const categoryByRoot: Record<string, string> = {
  monitoring: "Workspace",
  sources: "Sources",
  apps: "Apps",
  resources: "Resources",
  servers: "Servers",
  deployments: "Deployments",
  workloads: "Deployments",
  previews: "Previews",
  settings: "Workspace",
  profile: "Workspace",
  "system-health": "Workspace",
  github: "Integrations",
  aws: "Integrations",
  azure: "Integrations",
  gcp: "Integrations",
};

export const sectionOrder = [
  "Overview",
  "Sync & manifest",
  "Auto-deploy",
  "Deployments",
  "Runtime & logs",
  "Backups & restores",
  "Previews",
  "Inventory",
  "Capacity",
  "Monitoring",
  "Scout Agent",
  "Scout Alerts",
  "Performance comparisons",
  "Checks & preparation",
  "Credentials & trust",
  "Maintenance",
  "Progress & logs",
  "Actions",
  "Security scans",
  "Secrets",
  "Shared secrets",
  "System health",
  "Identity",
  "GitHub",
  "AWS",
  "Azure",
  "GCP",
  "Lifecycle",
];

// Match the most specific task before a broader collection or runtime route.
const rules: Record<string, Array<[string, RegExp]>> = {
  monitoring: [
    ["Security scans", /^\/monitoring\/security-scans$/],
    ["Monitoring", /^\/monitoring\/(entities|alerts|incidents)$/],
  ],
  sources: [
    ["Secrets", /\/secrets(?:\/|$)/],
    ["Auto-deploy", /\/auto-deploy-control$/],
    ["Sync & manifest", /\/(manifest|syncs|actions)(?:\/|$)/],
    ["Inventory", /\/(apps|resources|capacity|deployments|backups|previews)$/],
    ["Overview", /^\/sources(?:\/[^/]+)?$/],
  ],
  apps: [
    ["Scout Agent", /\/metrics$/],
    ["Secrets", /\/secrets(?:\/|$)/],
    ["Previews", /\/previews$/],
    [
      "Deployments",
      /\/(auto-deploy-control|deployments|releases)$|\/actions\/(deploy|rollback)$/,
    ],
    ["Runtime & logs", /\/(operations|actions)(?:\/|$)/],
    ["Overview", /^\/apps(?:\/[^/]+)?$/],
  ],
  resources: [
    ["Scout Agent", /\/metrics$/],
    ["Secrets", /\/secrets(?:\/|$)/],
    [
      "Backups & restores",
      /\/backup-assurance$|\/actions\/(backup|restore|restore-cleanup|cancel)$|\/operations\/[^/]+\/events$/,
    ],
    [
      "Deployments",
      /\/(auto-deploy-control|deployments|releases)$|\/actions\/(deploy|rollback)$/,
    ],
    ["Runtime & logs", /\/(operations|actions)(?:\/|$)/],
    ["Overview", /^\/resources(?:\/[^/]+)?$/],
  ],
  workloads: [
    [
      "Performance comparisons",
      /\/(comparison-deployments|deployment-comparison)$/,
    ],
  ],
  servers: [
    ["Scout Alerts", /\/scout-alerts(?:\/|$)/],
    ["Scout Agent", /\/(monitoring|metrics)(?:\/|$)/],
    ["Credentials & trust", /\/(credentials|host-keys)(?:\/|$)/],
    [
      "Checks & preparation",
      /\/(checks|preparations)$|\/actions\/(check|prepare)$/,
    ],
    ["Maintenance", /\/orphans$|\/actions\/cleanup-orphans$/],
    ["Capacity", /\/capacity$/],
    ["Inventory", /\/(apps|resources|deployments)$/],
    ["Overview", /^\/servers(?:\/[^/]+)?$/],
  ],
  deployments: [
    ["Security scans", /\/vulnerability-scan\//],
    ["Progress & logs", /\/(steps|logs|events)$/],
    ["Actions", /\/actions\//],
    ["Overview", /^\/deployments(?:\/[^/]+)?$/],
  ],
  previews: [["Lifecycle", /^\/previews\//]],
  settings: [["Shared secrets", /^\/settings\/secrets(?:\/|$)/]],
  profile: [["Identity", /^\/profile$/]],
  "system-health": [["System health", /^\/system-health(?:\/|$)/]],
  github: [["GitHub", /^\/github(?:\/|$)/]],
  aws: [["AWS", /^\/aws$/]],
  azure: [["Azure", /^\/azure$/]],
  gcp: [["GCP", /^\/gcp$/]],
};

export function referenceGroup(path: string): [string, string] {
  const root = path.split("/")[1]!;
  const category = categoryByRoot[root];
  const section = rules[root]?.find(([, pattern]) => pattern.test(path))?.[0];
  if (!category || !section)
    throw new Error(`Classify the API route before publishing: ${path}`);
  return [category, section];
}
