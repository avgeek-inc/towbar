import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:tls";
import type { TLSSocket } from "node:tls";

export async function createSmtpCapture() {
  const directory = await mkdtemp(join(tmpdir(), "towbar-smtp-test-"));
  const keyPath = join(directory, "key.pem"),
    certPath = join(directory, "cert.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-subj",
      "/CN=smtp.towbar.test",
      "-addext",
      "subjectAltName=DNS:smtp.towbar.test",
    ],
    { stdio: "ignore" },
  );
  const ca = await readFile(certPath);
  const messages: string[] = [],
    sockets = new Set<TLSSocket>();
  let authenticated = false;
  const server = createServer(
    { key: await readFile(keyPath), cert: ca },
    (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => undefined);
      socket.setEncoding("utf8");
      let buffer = "",
        receiving = false;
      socket.write("220 smtp.towbar.test ESMTP\r\n");
      socket.on("data", (chunk) => {
        buffer += chunk.toString();
        while (buffer.includes("\r\n")) {
          if (receiving) {
            const end = buffer.indexOf("\r\n.\r\n");
            if (end < 0) break;
            messages.push(buffer.slice(0, end));
            buffer = buffer.slice(end + 5);
            receiving = false;
            socket.write("250 2.0.0 Accepted for local capture\r\n");
            continue;
          }
          const end = buffer.indexOf("\r\n");
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (line.startsWith("EHLO"))
            socket.write("250-smtp.towbar.test\r\n250 AUTH PLAIN\r\n");
          else if (line.startsWith("AUTH PLAIN ")) {
            authenticated =
              Buffer.from(line.slice(11), "base64").toString() ===
              "\0fixture\0fixture-password";
            socket.write(
              authenticated
                ? "235 2.7.0 Authenticated\r\n"
                : "535 5.7.0 Authentication failed\r\n",
            );
          } else if (line === "DATA") {
            receiving = true;
            socket.write("354 End with dot\r\n");
          } else if (line === "QUIT") socket.end("221 Bye\r\n");
          else socket.write("250 OK\r\n");
        }
      });
    },
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("SMTP capture did not bind");
  return {
    ca,
    messages,
    port: address.port,
    authenticated: () => authenticated,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    },
  };
}
