import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("./index.html", import.meta.url));
const server = createServer((request, response) => {
  const path = (request.url ?? "/").split("?")[0];
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end();
    return;
  }
  if (path === "/health") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ status: "ok" }));
    return;
  }
  if (path === "/") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(page);
    return;
  }
  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("Not found");
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, "0.0.0.0", () => {
  console.log(`Hello Towbar listening on port ${server.address().port}`);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
