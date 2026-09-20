import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";

test(
  "serves the app and health endpoint, then shuts down cleanly",
  { timeout: 15_000 },
  async (t) => {
    const child = spawn(process.execPath, ["src/server.mjs"], {
      cwd: new URL("../", import.meta.url),
      env: { ...process.env, PORT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    t.after(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    });
    const exit = once(child, "exit");
    const port = await new Promise((resolve, reject) => {
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
        const match = output.match(/listening on port (\d+)/);
        if (match) resolve(match[1]);
      });
      child.on("error", reject);
      child.once("exit", (code) =>
        reject(new Error(`Server exited before listening: ${code}`)),
      );
    });
    const origin = `http://127.0.0.1:${port}`;
    const page = await fetch(origin);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type"), /text\/html/);
    assert.match(await page.text(), /Your app is running\./);
    const health = await fetch(`${origin}/health?probe=1`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok" });
    assert.equal((await fetch(`${origin}/missing`)).status, 404);
    const rejected = await fetch(origin, { method: "POST" });
    assert.equal(rejected.status, 405);
    assert.equal(rejected.headers.get("allow"), "GET, HEAD");
    const head = await fetch(`${origin}/health`, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    child.kill("SIGTERM");
    const [code, signal] = await exit;
    assert.equal(code, 0);
    assert.equal(signal, null);
  },
);
