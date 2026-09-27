import { parentPort } from "node:worker_threads";
import { createFixtureApiServer } from "../fixture-api.ts";

// A new isolate reloads every module, including the fixture's module-level maps.
const server = createFixtureApiServer({
  publicDemo: true,
  githubAppConnected: true,
  notificationProvidersConfigured: true,
});
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (address && typeof address === "object")
    parentPort!.postMessage({ port: address.port });
});
