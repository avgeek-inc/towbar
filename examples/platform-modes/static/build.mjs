import { cp, mkdir, rm } from "node:fs/promises";

await rm(new URL("./dist", import.meta.url), { force: true, recursive: true });
await mkdir(new URL("./dist", import.meta.url), { recursive: true });
await cp(
  new URL("./src/index.html", import.meta.url),
  new URL("./dist/index.html", import.meta.url),
);
