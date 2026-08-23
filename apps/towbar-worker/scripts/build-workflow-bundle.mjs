import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { bundleWorkflowCode } from "@temporalio/worker";

const applicationDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const outputDirectory = path.join(applicationDirectory, "dist");
const workflowsPath = path.join(outputDirectory, "workflows", "index.js");
const outputPath = path.join(outputDirectory, "workflow-bundle.js");

await mkdir(outputDirectory, { recursive: true });
const bundle = await bundleWorkflowCode({ workflowsPath });
await writeFile(outputPath, bundle.code, "utf8");
