import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";

const out = new URL("../../dist/public-demo/", import.meta.url);
await mkdir(out, { recursive: true });
await build({
  entryPoints: [new URL("./worker.ts", import.meta.url).pathname],
  outfile: new URL("worker.mjs", out).pathname,
  platform: "node",
  target: "node24",
  format: "esm",
  bundle: true,
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
  // Optional native ws accelerators must not become deployment dependencies.
  external: ["bufferutil", "utf-8-validate"],
});
for (const name of ["gateway.mjs", "policy.mjs", "start.mjs"])
  await copyFile(new URL(name, import.meta.url), new URL(name, out));
