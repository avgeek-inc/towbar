import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../", import.meta.url));
const sourceDirectory = path.join(repository, "infra/towbar-cli");
const target = path.join(repository, "infra/towbar");
const fragments = [
  "00-runtime.sh",
  "10-onboarding.sh",
  "20-host.sh",
  "30-release.sh",
  "40-lifecycle.sh",
  "50-doctor.sh",
  "60-commands.sh",
];
const content = `${(
  await Promise.all(
    fragments.map(async (fragment) =>
      (await readFile(path.join(sourceDirectory, fragment), "utf8")).trimEnd(),
    ),
  )
).join("\n\n")}\n`;

if (process.argv.includes("--check")) {
  const generated = await readFile(target, "utf8");
  if (generated !== content) {
    console.error("infra/towbar is stale; run pnpm cli:build");
    process.exitCode = 1;
  }
} else {
  await writeFile(target, content);
  await chmod(target, 0o755);
}
