import process from "node:process";
import { spawn } from "node:child_process";
import { createDemoServer } from "./gateway.mjs";

const gateway = createDemoServer({
  origin: process.env.DEMO_ORIGIN,
});
// Pass only the UI's minimal runtime configuration. Never inherit host credentials.
const web = spawn(process.execPath, ["apps/towbar-web-app/server.js"], {
  env: {
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    HOSTNAME: "127.0.0.1",
    PORT: "4021",
  },
  stdio: "inherit",
});
let stopping = false;
async function stop(code) {
  if (stopping) return;
  stopping = true;
  web.kill("SIGTERM");
  const deadline = setTimeout(() => process.exit(code), 10_000).unref();
  await gateway.stopDemo();
  clearTimeout(deadline);
  process.exit(code);
}
web.on("error", () => {
  void stop(1);
});
web.on("exit", () => {
  void stop(1);
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    void stop(0);
  });
// Do not advertise readiness until the UI can answer requests.
for (let attempt = 0; attempt < 60; attempt++) {
  try {
    const response = await fetch("http://127.0.0.1:4021/health", {
      signal: AbortSignal.timeout(1000),
    });
    if (response.ok) break;
  } catch {
    /* UI is still starting. */
  }
  if (attempt === 59) await stop(1);
  await new Promise((resolve) => setTimeout(resolve, 500));
}
gateway.listen(8080, "0.0.0.0", () => console.info("Towbar public demo ready"));
