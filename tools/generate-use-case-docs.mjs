import assert from "node:assert/strict";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";
import { parse, stringify } from "yaml";

const root = fileURLToPath(new URL("../", import.meta.url));
const docs = path.join(root, "docs/docs/use-cases");
const catalog = JSON.parse(
  await readFile(path.join(root, "tools/use-case-catalog.json"), "utf8"),
);
const check = process.argv.includes("--check");
const server = "192.0.2.10";
const otherServer = "192.0.2.11";
const categories = new Set([
  "oss",
  "services/build",
  "services/runtime",
  "services/operations",
  "datastores/sql",
  "datastores/document-analytics",
  "datastores/cache",
  "datastores/recovery",
  "stacks/web",
  "stacks/workers",
]);

assert.equal(catalog.length, 100);
assert.deepEqual(
  catalog.map(({ id }) => id),
  Array.from({ length: 100 }, (_, index) => index + 1),
);
assert.equal(
  new Set(catalog.map(({ category, slug }) => `${category}/${slug}`)).size,
  100,
);
for (const entry of catalog) assert.ok(categories.has(entry.category));

function firstYaml(file) {
  const source = fileCache.get(file);
  assert.ok(source, `Missing source guide: ${file}`);
  const match = source.match(/```yaml[^\n]*\n([\s\S]*?)```/);
  assert.ok(match, `Missing YAML in ${file}`);
  return parse(match[1]);
}

const fileCache = new Map();
for (const file of [
  ...["dockerfile", "static", "railpack", "nixpacks", "buildpack", "image"].map(
    (mode) => `docs/docs/services/modes/${mode}.mdx`,
  ),
  ...[
    "postgresql",
    "mysql",
    "mariadb",
    "mongodb",
    "redis",
    "dragonfly",
    "keydb",
    "clickhouse",
  ].map((engine) => `docs/docs/databases/${engine}.mdx`),
])
  fileCache.set(file, await readFile(path.join(root, file), "utf8"));

const engineGuide = {
  postgres: "postgresql",
  mysql: "mysql",
  mariadb: "mariadb",
  mongodb: "mongodb",
  redis: "redis",
  dragonfly: "dragonfly",
  keydb: "keydb",
  clickhouse: "clickhouse",
};
const productLogos = {
  1: "umami",
  2: "grafana",
  3: "gitea",
  4: "forgejo",
  5: "vaultwarden",
  6: "uptimekuma",
  7: "metabase",
  8: "paperlessngx",
  9: "meilisearch",
  10: "jellyfin",
  87: "meilisearch",
  89: "metabase",
  90: "umami",
};

function logoFor(entry) {
  if (productLogos[entry.id])
    return `/assets/use-case-logos/${productLogos[entry.id]}.svg`;
  if (entry.category.startsWith("datastores/")) {
    const engine = engineGuide[datastoreEngine(entry.id)];
    return `/assets/database-logos/${engine}.${["dragonfly", "keydb"].includes(engine) ? "svg" : "webp"}`;
  }
  const stackEngine = {
    81: "postgresql",
    82: "mysql",
    83: "mariadb",
    84: "mongodb",
    85: "redis",
    86: "dragonfly",
    88: "clickhouse",
    91: "redis",
    92: "postgresql",
    93: "redis",
    98: "postgresql",
    99: "postgresql",
    100: "postgresql",
  }[entry.id];
  if (stackEngine)
    return `/assets/database-logos/${stackEngine}.${stackEngine === "dragonfly" ? "svg" : "webp"}`;
  if (entry.id === 33) return "/assets/integration-logos/infisical.webp";
  if (entry.id === 34) return "/assets/integration-logos/doppler.ico";
  if ([11, 12, 13, 14, 20, 95].includes(entry.id))
    return "/assets/integration-logos/docker.webp";
  return null;
}

function service(id = "web", name = "Web Service", mode = "dockerfile") {
  const manifest = firstYaml(`docs/docs/services/modes/${mode}.mdx`);
  manifest.id = id;
  manifest.name = name;
  manifest.environments = { production: { server } };
  delete manifest.domains;
  delete manifest.tls;
  delete manifest.preview;
  if (mode !== "image") {
    manifest.deployment.context = ".";
    delete manifest.deployment.architecture;
    delete manifest.deployment.cache;
    delete manifest.deployment.configFile;
    if (mode === "dockerfile") {
      manifest.deployment.dockerfile = "Dockerfile";
      delete manifest.deployment.target;
    }
    if (mode === "static")
      manifest.deployment.buildCommand = ["npm", "run", "build"];
  }
  return manifest;
}

function datastore(engine, id = engine) {
  const manifest = firstYaml(`docs/docs/databases/${engineGuide[engine]}.mdx`);
  manifest.id = id;
  manifest.name = {
    postgres: "PostgreSQL",
    mysql: "MySQL",
    mariadb: "MariaDB",
    mongodb: "MongoDB",
    redis: "Redis",
    dragonfly: "Dragonfly",
    keydb: "KeyDB",
    clickhouse: "ClickHouse",
  }[engine];
  manifest.environments = { production: { server } };
  manifest.container.network = "application";
  manifest.container.networkAlias = id;
  delete manifest.access;
  delete manifest.backup;
  return manifest;
}

function caseId(entry, role = "") {
  const stem = entry.slug.replace(/^\d+-/, "");
  return role ? `${stem}-${role}` : stem;
}

function compose(id, name, serviceName, port) {
  return {
    id,
    name,
    file: `deploy/${id}/compose.yml`,
    strategy: "maintenance",
    services: {
      [serviceName]: {
        port,
        domains: [`${id}.example.com`],
        ingress: { type: "proxy" },
      },
    },
    environments: { production: { server } },
  };
}

function backup(integration = "aws") {
  return {
    integration,
    schedule: { cron: "0 3 * * *", timezone: "UTC" },
    retention: { keepLast: 14 },
  };
}

function serviceFile(manifest) {
  return [`.towbar/services/${manifest.id}.service.yml`, manifest];
}
function datastoreFile(manifest) {
  return [`.towbar/datastores/${manifest.id}.datastore.yml`, manifest];
}
function composeFile(manifest) {
  return [`.towbar/services/${manifest.id}.compose.yml`, manifest];
}
function rootFile(previews = false) {
  return [
    "towbar.yml",
    {
      version: 2,
      environments: {
        production: previews ? { previews: { enabled: true } } : {},
      },
    },
  ];
}

function ossFiles(entry) {
  const products = {
    2: ["grafana", 3000],
    3: ["server", 3000],
    4: ["server", 3000],
    5: ["vaultwarden", 80],
    7: ["metabase", 3000],
    8: ["webserver", 8000],
    9: ["meilisearch", 7700],
    10: ["jellyfin", 8096],
  };
  if (entry.id === 1) {
    const app = service("umami", "Umami", "image");
    app.deployment.image =
      "ghcr.io/umami-software/umami:3.4@sha256:6cd9d24a836fac5c226c3c90cb25141d4560b7270b7827f393ccf09bf3f83b18";
    app.deployment.platform = "linux/amd64";
    app.container.port = 3000;
    app.container.network = "application";
    app.health = { path: "/" };
    app.secrets = { runtime: ["DATABASE_URL"] };
    app.domains = { primary: "umami.example.com" };
    app.tls = { mode: "direct" };
    const db = datastore("postgres", "umami-postgres");
    db.name = "Umami PostgreSQL";
    return [datastoreFile(db), serviceFile(app)];
  }
  if (entry.id === 6) {
    const app = service("uptime-kuma", "Uptime Kuma", "image");
    app.deployment.image = "louislam/uptime-kuma:2";
    app.container.port = 3001;
    app.container.volumes = [
      { name: "data", mountPath: "/app/data", initialData: "image" },
    ];
    app.health = { path: "/" };
    app.rollout = {
      type: "recreate",
      maintenanceMode: true,
      reason: "Single-writer data volume",
    };
    app.domains = { primary: "uptime-kuma.example.com" };
    app.tls = { mode: "direct" };
    return [serviceFile(app)];
  }
  const [serviceName, port] = products[entry.id];
  const files = [
    composeFile(
      compose(entry.slug.replace(/^\d+-/, ""), entry.title, serviceName, port),
    ),
  ];
  return files;
}

function serviceFiles(entry) {
  const { id } = entry;
  const mode =
    {
      15: "static",
      16: "static",
      17: "railpack",
      18: "nixpacks",
      19: "buildpack",
      20: "image",
    }[id] ?? "dockerfile";
  const app = service(caseId(entry), entry.title, mode);
  const files = [];
  if (id === 12) app.deployment.target = "runtime";
  if (id === 13 || id === 32) app.secrets = { build: ["PACKAGE_TOKEN"] };
  if (id === 14) app.buildServer = { ip: otherServer };
  if (id === 15) delete app.deployment.spaFallback;
  if (id === 16) app.deployment.spaFallback = true;
  if (id === 22) app.health.timeoutSeconds = 90;
  if (id === 23) app.container.resources = { cpus: 2, memory: "2g" };
  if ([24, 25, 26].includes(id)) app.container.network = "application";
  if (id === 25) {
    app.secrets = { runtime: ["DATABASE_URL"] };
    files.push(datastoreFile(datastore("postgres", caseId(entry, "postgres"))));
  }
  if (id === 26) {
    app.secrets = { runtime: ["REDIS_URL"] };
    files.push(datastoreFile(datastore("redis", caseId(entry, "redis"))));
  }
  if (id === 27 || id === 30) {
    app.container.volumes = [
      { name: "uploads", mountPath: "/app/uploads", initialData: "image" },
    ];
    app.rollout = {
      type: "recreate",
      maintenanceMode: true,
      reason: "Single-writer uploaded files",
    };
  }
  if (id === 28) {
    app.domains = { primary: "app.example.com" };
    app.tls = { mode: "direct" };
  }
  if (id === 29) {
    app.domains = {
      primary: "app.example.com",
      redirects: [{ host: "www.example.com", status: 301 }],
    };
    app.tls = { mode: "direct" };
  }
  if (id === 31) app.secrets = { runtime: ["API_TOKEN"] };
  if (id === 33) {
    app.externalSecrets = {
      integration: "infisical",
      project: "11111111-1111-4111-8111-111111111111",
      environmentSlug: "prod",
      secretPath: "application",
    };
    app.secrets = { runtime: ["API_TOKEN"] };
  }
  if (id === 34) {
    app.externalSecrets = {
      integration: "doppler",
      project: "example-api",
      config: "prd",
    };
    app.secrets = { runtime: ["API_TOKEN"] };
  }
  if (id === 35)
    app.autoDeploy = {
      inputs: ["package.json", "pnpm-lock.yaml", "apps/api/**"],
    };
  if (id === 36) {
    app.preview = {
      enabled: true,
      domain: "preview.example.com",
      ttlHours: 72,
    };
    files.push(rootFile(true));
  }
  if (id === 37)
    app.jobs = [
      {
        name: "daily-report",
        command: ["node", "scripts/report.js"],
        schedule: { cron: "0 2 * * *", timezone: "UTC" },
        timeoutSeconds: 300,
        enabled: true,
      },
    ];
  if (id === 38)
    app.hooks = {
      preDeploy: {
        command: ["node", "scripts/migrate.js"],
        timeoutSeconds: 300,
      },
    };
  if (id === 39)
    app.notifications = {
      email: [
        {
          address: "ops@example.com",
          deployments: true,
          backupsAndRestores: false,
          alertsAndIncidents: true,
        },
      ],
    };
  if (id === 40) app.vulnerabilityScanning = true;
  files.push(serviceFile(app));
  return files;
}

function datastoreEngine(id) {
  if (id <= 44) return "postgres";
  if (id <= 47) return "mysql";
  if (id <= 50) return "mariadb";
  if (id <= 55) return "mongodb";
  if (id <= 60) return "clickhouse";
  if (id <= 64) return "redis";
  if (id <= 67) return "dragonfly";
  if (id <= 70) return "keydb";
  return "postgres";
}

function datastoreFiles(entry) {
  const { id } = entry;
  const engine = datastoreEngine(id);
  const db = datastore(engine, caseId(entry));
  db.name = entry.title;
  const files = [];
  if ([41, 45, 48].includes(id)) {
    db.secrets.runtime =
      engine === "postgres" ? ["POSTGRES_PASSWORD"] : ["MYSQL_ROOT_PASSWORD"];
  }
  if ([43, 50, 54, 63].includes(id))
    db.access = { sshTunnel: { hostPort: 15000 + id } };
  if ([44, 47, 55, 60, 64, 67, 70, 71, 72, 73, 77, 80].includes(id))
    db.backup = backup();
  if (id === 71) db.backup = { integration: "aws" };
  if (id === 58 && !db.secrets.runtime.includes("CLICKHOUSE_DB"))
    db.secrets.runtime.push("CLICKHOUSE_DB");
  if (id === 59) db.container.resources = { cpus: 2, memory: "4g" };
  if (id === 62) {
    for (const name of ["producer", "worker"]) {
      const app = service(caseId(entry, name), `${entry.title} ${name}`);
      app.container.network = "application";
      app.secrets = { runtime: ["QUEUE_URL"] };
      files.push(serviceFile(app));
    }
  }
  if (id === 74) db.backup = backup("s3");
  if (id === 75) db.backup = backup("gcs");
  if (id === 76)
    db.backup = {
      schedule: { cron: "0 3 * * *", timezone: "UTC" },
      retention: { keepLast: 14 },
      s3: { bucket: "example-production-backups", region: "ap-south-1" },
      gcs: { bucket: "example-recovery-backups", region: "asia-south1" },
      restoreFrom: "s3",
    };
  if (id === 78) db.environments.staging = { server: otherServer };
  files.unshift(datastoreFile(db));
  return files;
}

function stackFiles(entry) {
  const { id } = entry;
  if (id === 100) {
    const files = [];
    for (const [scope, target] of [
      ["orders", server],
      ["billing", otherServer],
    ]) {
      const name = `${scope[0].toUpperCase()}${scope.slice(1)}`;
      const db = datastore("postgres", `${scope}-postgres`);
      db.name = `${name} PostgreSQL`;
      db.environments.production.server = target;
      const app = service(`${scope}-api`, `${name} API`);
      app.environments.production.server = target;
      app.container.network = "application";
      app.secrets = { runtime: ["DATABASE_URL"] };
      files.push(datastoreFile(db), serviceFile(app));
    }
    return files;
  }
  const engine = {
    81: "postgres",
    82: "mysql",
    83: "mariadb",
    84: "mongodb",
    85: "redis",
    86: "dragonfly",
    88: "clickhouse",
    89: "postgres",
    90: "postgres",
    91: "redis",
    92: "postgres",
    93: "redis",
    98: "postgres",
    99: "postgres",
  }[id];
  const files = [];
  if (engine) {
    const db = datastore(engine, caseId(entry, engine));
    db.name = `${entry.title} ${db.name}`;
    files.push(datastoreFile(db));
  }
  if (id === 87) {
    const app = service(caseId(entry, "api"), "Search API");
    app.secrets = { runtime: ["SEARCH_URL", "SEARCH_KEY"] };
    files.push(serviceFile(app));
    return files;
  }
  if ([89, 90].includes(id)) {
    const product = id === 89 ? "metabase" : "umami";
    if (id === 90) return ossFiles({ id: 1 });
    files.length = 0;
    const app = compose(product, entry.title, product, 3000);
    files.push(composeFile(app));
    return files;
  }
  if (id === 95) {
    files.push(
      composeFile(compose("web-worker", "Web and worker", "web", 3000)),
    );
    return files;
  }
  if (id === 94) {
    const frontend = service(
      caseId(entry, "frontend"),
      "Static frontend",
      "static",
    );
    frontend.domains = { primary: "app.example.com" };
    frontend.tls = { mode: "direct" };
    const api = service(caseId(entry, "api"), "API");
    api.domains = { primary: "api.example.com" };
    api.tls = { mode: "direct" };
    files.push(serviceFile(frontend), serviceFile(api));
    return files;
  }
  const app = service(caseId(entry, "api"), entry.title);
  app.container.network = "application";
  if (engine)
    app.secrets = {
      runtime: [
        engine === "redis" || engine === "dragonfly"
          ? "CACHE_URL"
          : "DATABASE_URL",
      ],
    };
  if (id === 92)
    app.jobs = [
      {
        name: "daily-report",
        command: ["node", "scripts/report.js"],
        schedule: { cron: "0 2 * * *", timezone: "UTC" },
        timeoutSeconds: 300,
        enabled: true,
      },
    ];
  if (id === 93) {
    app.domains = { primary: "webhooks.example.com" };
    app.tls = { mode: "direct" };
  }
  if (id === 96) {
    app.preview = {
      enabled: true,
      domain: "preview.example.com",
      ttlHours: 72,
    };
    files.push(rootFile(true));
  }
  if (id === 97) app.environments.staging = { server: otherServer };
  if (id === 98) {
    app.container.volumes = [
      { name: "uploads", mountPath: "/app/uploads", initialData: "image" },
    ];
    app.rollout = {
      type: "recreate",
      maintenanceMode: true,
      reason: "Single-writer uploads",
    };
  }
  files.push(serviceFile(app));
  if ([86, 91, 93, 99].includes(id)) {
    const worker = service(caseId(entry, "worker"), "Worker");
    worker.container.network = "application";
    worker.secrets = {
      runtime: [engine === "postgres" ? "DATABASE_URL" : "QUEUE_URL"],
    };
    files.push(serviceFile(worker));
  }
  return files;
}

function filesFor(entry) {
  if (entry.category === "oss") return ossFiles(entry);
  if (entry.category.startsWith("services/")) return serviceFiles(entry);
  if (entry.category.startsWith("datastores/")) return datastoreFiles(entry);
  return stackFiles(entry);
}

function yamlBlock([file, manifest]) {
  return `\`\`\`yaml title="${file}"\n${stringify(manifest).trimEnd()}\n\`\`\``;
}

function configure(entry, files) {
  const steps = [
    "Register and prepare the example server or servers, connect the repository, and map `production` to the branch containing these files.",
  ];
  if (files.some(([, manifest]) => manifest.environments?.staging))
    steps.push(
      "Map `staging` to its repository branch, register its target server, and save staging credentials separately from production.",
    );
  if (entry.category === "oss" && ![1, 6].includes(entry.id))
    steps.push(
      `Copy the current [upstream installation](${entry.upstream}) into the repository at \`deploy/${entry.slug.replace(/^\d+-/, "")}/compose.yml\`. Pin its images, match the Compose service name shown above, and adapt mounts, ports, and networks to [Towbar's Compose restrictions](/docs/services/modes/compose).`,
    );
  if (entry.category !== "oss") {
    for (const [, manifest] of files.filter(([file]) =>
      file.endsWith(".compose.yml"),
    ))
      steps.push(
        `Commit a Compose file at \`${manifest.file}\` with the declared service name and port. Adapt it to [Towbar's Compose restrictions](/docs/services/modes/compose) before syncing.`,
      );
  }
  if (files.some(([file]) => file.endsWith(".datastore.yml")))
    steps.push(
      "Save each Datastore credential value under **Datastore → Settings → Secrets**, deploy it first, and verify engine readiness before starting a dependent Service.",
    );
  if (files.some(([, manifest]) => manifest.backup))
    steps.push(
      "Enable the selected backup integration and configure its runtime storage credentials and destination before creating a recovery point. A manifest policy alone does not provide storage access.",
    );
  if (
    files.some(([, manifest]) => manifest.preview) ||
    files.some(([file]) => file === "towbar.yml")
  )
    steps.push(
      "Configure preview DNS and isolated preview secrets, then verify a pull request creates a separate preview workload.",
    );
  if (
    files.some(
      ([file, manifest]) =>
        file.endsWith(".service.yml") &&
        (manifest.secrets || manifest.externalSecrets),
    )
  )
    steps.push(
      "Save the Service's declared keys in its selected environment, or enable and authorize the selected [external-secret provider](/docs/secrets/external). Do not commit the values.",
    );
  const databases = files.filter(([file]) => file.endsWith(".datastore.yml"));
  const services = files.filter(([file]) => file.endsWith(".service.yml"));
  if (
    databases.length === 1 &&
    services.length > 0 &&
    ![1, 90].includes(entry.id)
  )
    steps.push(
      `Point each Service connection secret at \`${databases[0][1].container.networkAlias}\` on the database engine's private port. The server and network must match; credentials are saved separately for each Service.`,
    );
  if (entry.id === 100)
    steps.push(
      "Set `orders-api`'s `DATABASE_URL` to the `orders-postgres` alias and `billing-api`'s URL to `billing-postgres`. Save each value on its own Service; the two Docker networks are local to their servers.",
    );
  if (entry.id === 1 || entry.id === 90)
    steps.push(
      "Set the Service's `DATABASE_URL` to `postgresql://<user>:<password>@umami-postgres:5432/<database>`, using the user, name, and password you configured on the Datastore. A Docker network does not copy those values. Change Umami's default administrator password after first login.",
    );
  if (entry.id === 10)
    steps.push(
      "Add persistent configuration, cache, and media volumes in the upstream Compose file. This example covers HTTP access; DLNA, host networking, and hardware transcoding need capabilities outside this manifest.",
    );
  if (entry.id === 89)
    steps.push(
      "Use the upstream PostgreSQL Compose configuration in the same project and set Metabase's application-database variables there. The Towbar Compose manifest does not create or connect a separate managed Datastore.",
    );
  if (entry.id === 39)
    steps.push(
      "Configure and test `ops@example.com` as a workspace Email destination. The manifest selects which event categories it receives; it does not configure SMTP delivery.",
    );
  if ([45, 53, 81, 82, 83, 84, 88, 99].includes(entry.id))
    steps.push(
      "Create an application-specific user with only the required privileges after the database is ready. Save its connection URL on the consuming Service instead of reusing the Datastore's administrator credentials.",
    );
  if (entry.category === "oss" && ![1, 6].includes(entry.id))
    steps.push(
      "Supply the software's own required environment values and persistent storage according to its upstream guide. A valid Towbar manifest does not make an unadapted upstream Compose file deployable.",
    );
  steps.push(
    "Sync the repository, inspect the resolved configuration, deploy manually, and perform the verification below before enabling automation.",
  );
  return steps.map((step, index) => `${index + 1}. ${step}`).join("\n");
}

function renderCase(entry) {
  const files = filesFor(entry);
  const logo = logoFor(entry);
  const logoHeader = logo ? `icon: ${JSON.stringify(logo)}\n` : "";
  const logoElement = logo
    ? `<img className="towbar-doc-brand-logo" src="${logo}" alt="${entry.title} logo" aria-hidden="true" />\n\n`
    : "";
  const source = entry.upstream
    ? `\n**Upstream source:** [Current installation guide](${entry.upstream}).\n`
    : "";
  const related = [...entry.approach.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)]
    .filter(([, , href]) => href !== entry.upstream)
    .map(([, label, href]) => `[${label}](${href})`);
  const relatedNote = related.length
    ? `\n**Related reading:** ${related.join(", ")}.\n`
    : "";
  const composeNote = files.some(([file]) => file.endsWith(".compose.yml"))
    ? "\nThe Compose file itself must be committed at the path in the manifest. This page shows Towbar's declaration, not an invented upstream Compose specification. Match the actual service name and internal port when adapting the upstream file.\n"
    : "";
  const stackNote =
    entry.category.startsWith("stacks/") && files.length > 1
      ? "\nThese are separate files in one repository. A shared Docker network works only when the workloads run on the same server; Towbar does not automatically order their deployments or copy secret values between them.\n"
      : "";
  const deployment = files.find(([file]) => file.endsWith(".service.yml"))?.[1]
    .deployment;
  const modeNote = entry.category.startsWith("services/")
    ? deployment?.type === "image"
      ? "\nUse the image's actual listening port and health endpoint. Towbar does not build this image from the repository.\n"
      : deployment?.type === "static"
        ? "\n`context: .` means the repository root. The build command must produce the declared output directory; adapt it to the actual project.\n"
        : "\n`context: .` means the repository root. The source project, start command, and health endpoint must match the selected build mode.\n"
    : "";
  const guideLinks = [];
  if (files.some(([file]) => file.endsWith(".service.yml")))
    guideLinks.push("[Service manifest](/docs/services/manifest)");
  if (files.some(([file]) => file.endsWith(".datastore.yml")))
    guideLinks.push("[Datastore manifest](/docs/datastores/manifest)");
  if (files.some(([file]) => file.endsWith(".compose.yml")))
    guideLinks.push("[Compose guide](/docs/services/modes/compose)");
  return `---\ntitle: ${JSON.stringify(entry.title)}\ndescription: ${JSON.stringify(
    entry.approach
      .replace(/\s*\[[^\]]+\]\([^)]+\)/g, "")
      .replaceAll("`", "")
      .trim(),
  )}\n${logoHeader}---\n\n${logoElement}${source}${relatedNote}${composeNote}${stackNote}${modeNote}\n## Towbar manifest${files.length > 1 ? "s" : ""}\n\n${files.map(yamlBlock).join("\n\n")}\n\n## Configure\n\n${configure(entry, files)}\n\n## Verify\n\n${entry.verify}\n\nFor field constraints, see ${guideLinks.join(" and ")}.\n`;
}

const expected = new Map();
async function addPage(file, content) {
  expected.set(
    file,
    await format(content, { ...(await resolveConfig(file)), filepath: file }),
  );
}
for (const entry of catalog)
  await addPage(
    path.join(docs, entry.category, `${entry.slug}.mdx`),
    renderCase(entry),
  );

for (const [file, content] of expected) {
  if (check) {
    const actual = await readFile(file, "utf8").catch(() => null);
    assert.equal(
      actual,
      content,
      `Use-case page is stale: ${path.relative(root, file)}`,
    );
  } else {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
  }
}
for (const category of categories) {
  const directory = path.join(docs, category);
  for (const name of await readdir(directory)) {
    if (!name.endsWith(".mdx")) continue;
    const file = path.join(directory, name);
    if (!expected.has(file))
      throw new Error(`Unexpected use-case page: ${path.relative(root, file)}`);
  }
}
console.log(
  `${check ? "Checked" : "Generated"} ${catalog.length} use-case pages.`,
);
