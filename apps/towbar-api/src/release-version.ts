import { existsSync, readFileSync } from "node:fs";

export function getReleaseVersion() {
  const packagedManifest = new URL("../release-package.json", import.meta.url);
  const sourceManifest = new URL("../../../package.json", import.meta.url);
  const manifest = JSON.parse(
    readFileSync(
      existsSync(packagedManifest) ? packagedManifest : sourceManifest,
      "utf8",
    ),
  ) as { version: string };
  return manifest.version;
}
