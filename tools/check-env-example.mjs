import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const compose = await readFile(
  path.join(repositoryRoot, "docker-compose.yml"),
  "utf8",
);
const template = await readFile(
  path.join(repositoryRoot, ".env.example"),
  "utf8",
);

const injectedVariables = new Set(["SOURCE_COMMIT", "TOWBAR_IMAGE_TAG"]);
const installerVariables = ["COMPOSE_PROFILES", "TOWBAR_INSTALL_MODE"];
const activeVariables = new Set([
  "COMPOSE_PROFILES",
  "TOWBAR_API_BASE_URL",
  "TOWBAR_APP_BASE_URL",
  "TOWBAR_BIND_ADDRESS",
  "TOWBAR_CREDENTIALS_KEY",
  "TOWBAR_DATABASE_RUNTIME_PASSWORD",
  "TOWBAR_GATEWAY_DOMAIN",
  "TOWBAR_INSTALL_MODE",
  "TOWBAR_INTERNAL_HMAC_SECRET",
  "TOWBAR_NETWORK_NAME",
  "TOWBAR_PORT",
  "TOWBAR_POSTGRES_PASSWORD",
  "TOWBAR_TEMPORAL_UI_PORT",
  "TOWBAR_TRUSTED_PROXY_HOPS",
  "TOWBAR_WEBSITE_BASE_URL",
]);

const composeVariables = [...compose.matchAll(/\$\{([A-Z][A-Z0-9_]*)/gu)].map(
  (match) => match[1],
);
const expectedVariables = new Set([
  ...installerVariables,
  ...composeVariables.filter((name) => !injectedVariables.has(name)),
]);
const entries = new Map();

for (const [index, line] of template.split("\n").entries()) {
  const match = line.match(/^\s*(#\s*)?([A-Z][A-Z0-9_]*)=/u);
  if (!match) continue;
  const [, comment, name] = match;
  const existing = entries.get(name);
  if (existing) {
    throw new Error(
      `.env.example defines ${name} on both lines ${existing.line} and ${index + 1}`,
    );
  }
  entries.set(name, { active: !comment, line: index + 1 });
}

const failures = [];
for (const name of [...expectedVariables].sort()) {
  const entry = entries.get(name);
  if (!entry) {
    failures.push(`${name} is missing from .env.example`);
    continue;
  }
  const shouldBeActive = activeVariables.has(name);
  if (entry.active !== shouldBeActive) {
    failures.push(
      `${name} must be ${shouldBeActive ? "active" : "commented out"} on line ${entry.line}`,
    );
  }
}

for (const name of activeVariables) {
  if (!expectedVariables.has(name)) {
    failures.push(
      `${name} is active but is not used by the installer or Compose`,
    );
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `.env.example lists all ${expectedVariables.size} operator configuration variables; optional values are commented out.`,
  );
}
