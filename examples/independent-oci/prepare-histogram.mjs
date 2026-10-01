import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function prepareHistogram(directory) {
  const name = "histogram-quantile_linux_arm64.tar.gz";
  const response = await fetch(
    `https://github.com/SigNoz/signoz/releases/download/histogram-quantile/v0.0.1/${name}`,
  );
  if (!response.ok)
    throw new Error(`Histogram download failed: ${response.status}`);
  const archive = Buffer.from(await response.arrayBuffer());
  if (
    createHash("sha256").update(archive).digest("hex") !==
    "e5605ebffa82a450ebbcdf6cf19dad546e1e40d52dbf3e03cfd2d2d5b7394211"
  )
    throw new Error("Histogram archive checksum mismatch");
  const temporary = await mkdtemp(path.join(tmpdir(), "towbar-histogram-"));
  try {
    const source = path.join(temporary, name);
    await writeFile(source, archive);
    execFileSync("tar", [
      "-xzf",
      source,
      "-C",
      temporary,
      "histogram-quantile",
    ]);
    await writeFile(
      path.join(directory, "histogramQuantile"),
      await readFile(path.join(temporary, "histogram-quantile")),
      { mode: 0o755 },
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await prepareHistogram(fileURLToPath(new URL("config/", import.meta.url)));
  console.log(
    "Prepared the pinned Linux ARM64 histogram executable. Commit config/histogramQuantile in your deployment repository before syncing.",
  );
}
