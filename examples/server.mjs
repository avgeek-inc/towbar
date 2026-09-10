import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 3000);
const server = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "ok" }));
    return;
  }
  response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  response.end("Hello from Towbar!\n");
});
server.listen(port, "0.0.0.0");
process.once("SIGTERM", () => server.close());
process.once("SIGINT", () => server.close());
