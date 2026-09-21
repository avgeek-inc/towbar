import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";

const directory = "/app/uploads";
await mkdir(directory, { recursive: true });
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  try {
    if (request.method === "GET" && pathname === "/health") {
      response.writeHead(200).end("ok");
    } else if (request.method === "POST" && pathname === "/files") {
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 1024 * 1024) {
          response.writeHead(413).end("Maximum file size is 1 MiB");
          return;
        }
        chunks.push(chunk);
      }
      const id = randomUUID();
      await writeFile(`${directory}/${id}`, Buffer.concat(chunks), {
        flag: "wx",
      });
      response
        .writeHead(201, { "content-type": "application/json" })
        .end(JSON.stringify({ id }));
    } else if (request.method === "GET" && pathname === "/files") {
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify(await readdir(directory)));
    } else if (
      request.method === "GET" &&
      /^\/files\/[a-f0-9-]{36}$/.test(pathname)
    ) {
      const contents = await readFile(`${directory}/${pathname.slice(7)}`);
      response
        .writeHead(200, {
          "content-type": "application/octet-stream",
          "x-content-type-options": "nosniff",
        })
        .end(contents);
    } else {
      response.writeHead(404).end("Not found");
    }
  } catch (error) {
    response
      .writeHead(error.code === "ENOENT" ? 404 : 500)
      .end("Unable to access file");
  }
});
server.listen(3000, "0.0.0.0");
process.once("SIGTERM", () => server.close());
