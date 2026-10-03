import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { domainRoutingPython } from "./domain-routing.js";

void test("handoff removes only transferred routes and restores them after failure", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "towbar-domain-routes-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stage = path.join(root, "stage");
  const route = path.join(root, "api.caddy");
  const before =
    "example.com {\n\treverse_proxy 127.0.0.1:3000 {\n\t\tlb_policy round_robin\n\t}\n\ttls {\n\t\tdns cloudflare {env.CLOUDFLARE_API_TOKEN}\n\t}\n}\n\nother.example.com {\n\tredir https://example.com{uri} 301\n}\n";
  await writeFile(route, before);
  const script = domainRoutingPython.replace(
    '"/etc/caddy/towbar"',
    JSON.stringify(root),
  );
  const run = (
    mode: string,
    transfers = [{ previousAppId: "api", hostname: "example.com" }],
  ) =>
    execFileSync(
      "python3",
      ["-c", script, stage, mode, JSON.stringify(transfers)],
      { stdio: "pipe" },
    );
  run("apply");
  const after = await readFile(route, "utf8");
  assert.equal(
    after,
    "\nother.example.com {\n\tredir https://example.com{uri} 301\n}\n",
  );
  run("apply");
  run("rollback");
  assert.equal(await readFile(route, "utf8"), before);
  run("rollback");
  run("apply");
  assert.equal(await readFile(route, "utf8"), after);
  await writeFile(route, `${after}\n# manual edit\n`);
  assert.throws(() => run("rollback"), /refusing to overwrite/);
  assert.throws(
    () =>
      run("apply", [{ previousAppId: "../external", hostname: "example.com" }]),
    /Invalid previous runtime/,
  );
});
