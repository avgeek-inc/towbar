import { createServer } from "node:http";

const server = createServer((request, response) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      mode: process.env.RAILPACK_VERSION ? "railpack" : "node",
      path: request.url,
      status: "ok",
    }),
  );
});
server.listen(Number(process.env.PORT ?? 3000), "0.0.0.0");
process.once("SIGTERM", () => server.close());
