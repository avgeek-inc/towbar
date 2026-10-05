import { readFile, writeFile } from "node:fs/promises";
import { format } from "prettier";

const root = new URL("../", import.meta.url);
const identity = JSON.parse(
  await readFile(new URL("repository.json", root), "utf8"),
);
const check = process.argv.includes("--check");
if (
  !/^[a-z0-9-]+\/[a-z0-9-]+$/.test(identity.repository) ||
  !Number.isSafeInteger(identity.repositoryId) ||
  identity.repositoryId <= 0 ||
  !/^ghcr\.io\/[a-z0-9-]+$/.test(identity.imageRegistry) ||
  !/^https:\/\/[a-z0-9.-]+\/[a-z0-9-]+$/.test(identity.distributionUrl) ||
  !/^[a-z0-9-]+$/.test(identity.releaseBucket) ||
  !/^[a-z0-9-]+$/.test(identity.releasePrefix)
) {
  throw new Error("Invalid repository.json identity or distribution settings");
}
// Forks can validate without changing upstream identity. A transfer keeps the ID.
if (
  process.env.GITHUB_REPOSITORY_ID === String(identity.repositoryId) &&
  process.env.GITHUB_REPOSITORY !== identity.repository
) {
  throw new Error(
    "Upstream repository was renamed or transferred; update repository.json and run pnpm repository:sync",
  );
}
const failures = [];
async function output(path, expected) {
  let actual;
  try {
    actual = await readFile(new URL(path, root), "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (actual === expected) return;
  if (check) failures.push(`${path} is stale; run pnpm repository:sync`);
  else await writeFile(new URL(path, root), expected);
}
await output(
  "packages/towbar-contracts/src/repository-identity.ts",
  await format(
    `// Generated from repository.json; run pnpm repository:sync.
export const repositoryUrl = ${JSON.stringify("https://github.com/" + identity.repository)};
export const distributionUrl = ${JSON.stringify(identity.distributionUrl)};
`,
    { parser: "typescript" },
  ),
);
await output(
  "infra/upgrade-runner/repository_identity.py",
  `# Generated from repository.json; run pnpm repository:sync.
REPOSITORY = ${JSON.stringify(identity.repository)}
DISTRIBUTION_URL = ${JSON.stringify(identity.distributionUrl)}
REPOSITORY_URL = "https://github.com/" + REPOSITORY
`,
);
const packagePath = "package.json";
const pkg = JSON.parse(await readFile(new URL(packagePath, root), "utf8"));
pkg.bugs = `https://github.com/${identity.repository}/issues`;
pkg.repository.url = `git+https://github.com/${identity.repository}.git`;
await output(
  packagePath,
  await format(JSON.stringify(pkg), { parser: "json-stringify" }),
);
const goMod = await readFile(
  new URL("apps/towbar-monitoring-agent/go.mod", root),
  "utf8",
);
await output(
  "apps/towbar-monitoring-agent/go.mod",
  goMod.replace(
    /^module .+$/m,
    `module github.com/${identity.repository}/monitoring-agent`,
  ),
);
if (failures.length) throw new Error(failures.join("\n"));
console.log(
  check
    ? "Repository identity is consistent."
    : "Repository identity synchronized.",
);
