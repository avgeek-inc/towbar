import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const checkOnly = process.argv.includes("--check");

const publishedFiles = [
  ...["repository", "app", "resource"].map((kind) => ({
    source: `packages/towbar-core/schemas/${kind}.v2.json`,
    target: `docs/schemas/${kind}.v2.json`,
  })),
  { source: "examples/towbar.yml", target: "docs/examples/towbar.yaml" },
  {
    source: "examples/.towbar/apps/hello-towbar.app.yml",
    target: "docs/examples/hello-towbar.app.yaml",
  },
];

const failures = [];

for (const publishedFile of publishedFiles) {
  const sourcePath = path.join(repositoryRoot, publishedFile.source);
  const targetPath = path.join(repositoryRoot, publishedFile.target);
  const source = await readFile(sourcePath);

  if (!checkOnly) {
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, source);
    console.log(`Published ${publishedFile.source} to ${publishedFile.target}`);
    continue;
  }

  let target;
  try {
    target = await readFile(targetPath);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      failures.push(`${publishedFile.target} is missing`);
      continue;
    }
    throw error;
  }

  if (!source.equals(target)) {
    failures.push(
      `${publishedFile.target} differs from ${publishedFile.source}; run pnpm docs:sync`,
    );
  }
}

if (checkOnly && failures.length > 0) {
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
} else if (checkOnly) {
  console.log("Published documentation artifacts are in sync.");
}
