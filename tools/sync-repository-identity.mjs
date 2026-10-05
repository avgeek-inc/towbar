import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
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
  "packages/towbar-core/src/repository-identity.ts",
  await format(
    `// Generated from repository.json; run pnpm repository:sync.
export const repositoryIdentity = ${JSON.stringify(identity)} as const;
export const repositoryUrl = "https://github.com/" + repositoryIdentity.repository;
export const distributionUrl = repositoryIdentity.distributionUrl;
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
const config = {
  name: "avgeek-oss-releases",
  main: "worker.mjs",
  compatibility_date: "2026-10-05",
  workers_dev: false,
  routes: [
    {
      pattern: new URL(identity.distributionUrl).hostname,
      custom_domain: true,
    },
  ],
  r2_buckets: [{ binding: "RELEASES", bucket_name: identity.releaseBucket }],
  vars: {
    PRODUCTS: "towbar,mill,rootset,vitalog",
    DISTRIBUTION_ORIGIN: new URL(identity.distributionUrl).origin,
  },
};
await output(
  "infra/distribution/wrangler.json",
  await format(JSON.stringify(config), { parser: "json" }),
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
const files = execFileSync("git", ["ls-files", "-z"], { cwd: root })
  .toString()
  .split("\0")
  .filter(Boolean);
const generated = new Set([
  "packages/towbar-core/src/repository-identity.ts",
  "infra/upgrade-runner/repository_identity.py",
  "infra/towbar-cli/00-version.sh",
  "infra/towbar",
  "install.sh",
]);
for (const path of files.filter(
  (path) =>
    /\.(md|mdx|json|js|ts|tsx|py|sh|mjs)$/.test(path) &&
    !generated.has(path) &&
    path !== "repository.json" &&
    !/(\.test\.|\/test[-_])/.test(path),
)) {
  let source = await readFile(new URL(path, root), "utf8");
  if (
    /\.(md|mdx)$/.test(path) ||
    ["docs/docs.json", "docs/datafast.js", "infra/demo/.env.example"].includes(
      path,
    )
  ) {
    source = source.replaceAll(
      /((?:github\.com|raw\.githubusercontent\.com|api\.github\.com\/repos)\/)[a-z0-9-]+\/towbar(?=[/."'`#?\s]|$)/gi,
      "$1" + identity.repository,
    );
    source = source.replaceAll(
      /ghcr\.io\/[a-z0-9-]+(?=\/towbar-(?:api|worker|web-app|demo))/g,
      identity.imageRegistry,
    );
    if (path === "docs/datafast.js")
      source = source.replaceAll(
        /[a-z0-9-]+\\\/towbar/g,
        identity.repository.replaceAll("/", "\\/"),
      );
    await output(path, source);
  }
  for (const match of source.matchAll(
    /(?:github\.com|raw\.githubusercontent\.com|api\.github\.com\/repos)\/([a-z0-9-]+\/towbar)(?=[/."'`#?\s]|$)/gi,
  )) {
    if (match[1] !== identity.repository)
      failures.push(`${path} refers to obsolete repository ${match[1]}`);
  }
  if (
    /\.(ts|tsx|py|sh|mjs)$/.test(path) &&
    !/(\.test\.|\/test[-_]|[-/]fixture)/.test(path) &&
    source.includes(identity.repository)
  )
    failures.push(
      `${path} hardcodes the repository; use repository.json or generated constants`,
    );
}
if (failures.length) throw new Error(failures.join("\n"));
console.log(
  check
    ? "Repository identity is consistent."
    : "Repository identity synchronized.",
);
