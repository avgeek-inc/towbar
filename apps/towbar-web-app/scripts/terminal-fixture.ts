import { randomBytes } from "node:crypto";
import type { Server } from "node:http";
import { WebSocketServer } from "ws";

export function terminalFixture(isAdmin: () => boolean) {
  const tickets = new Map<string, number>();
  const prompt = "\u001b[32mdeploy@fixture\u001b[0m:\u001b[34m~\u001b[0m$ ";
  return {
    issue() {
      for (const [ticket, expires] of tickets)
        if (expires < Date.now()) tickets.delete(ticket);
      const ticket = randomBytes(32).toString("base64url");
      tickets.set(ticket, Date.now() + 30000);
      return {
        ticket,
        websocketPath: "/v1/terminal",
        expiresAt: new Date(Date.now() + 30000).toISOString(),
      };
    },
    attach(server: Server) {
      const wss = new WebSocketServer({ noServer: true, maxPayload: 65536 });
      server.on("upgrade", (request, socket, head) => {
        if (
          request.url !== "/v1/terminal" ||
          !isAdmin() ||
          !["http://localhost:4021", "http://127.0.0.1:4021"].includes(
            request.headers.origin ?? "",
          )
        ) {
          socket.destroy();
          return;
        }
        wss.handleUpgrade(request, socket, head, (ws) => {
          let connected = false;
          let input = "";
          const send = (data: string) =>
            ws.send(Buffer.from(data), { binary: true });
          ws.on("error", () => ws.close());
          ws.on("message", (raw) => {
            try {
              const message = JSON.parse(raw.toString());
              if (!isAdmin()) {
                ws.close();
                return;
              }
              if (message.type === "connect" && !connected) {
                const expires = tickets.get(message.ticket);
                tickets.delete(message.ticket);
                if (!expires || expires < Date.now()) {
                  ws.close();
                  return;
                }
                connected = true;
                ws.send(JSON.stringify({ type: "ready" }));
                send(
                  `\u001b[90mTowbar local fixture — no real server is connected.\r\nTry whoami, pwd, ls, uname, or exit.\u001b[0m\r\n\r\n${prompt}`,
                );
              } else if (
                connected &&
                message.type === "input" &&
                typeof message.data === "string" &&
                message.data.length <= 16384
              ) {
                for (const character of message.data) {
                  if (character === "\r" || character === "\n") {
                    const command = input.trim();
                    input = "";
                    const output =
                      command === "whoami"
                        ? "deploy"
                        : command === "pwd"
                          ? "/home/deploy"
                          : command === "ls"
                            ? "\u001b[34mapps  backups  logs\u001b[0m"
                            : command === "uname" || command === "uname -a"
                              ? "Linux fixture 6.8.0 x86_64 GNU/Linux"
                              : command
                                ? "\u001b[33mThis fixture supports whoami, pwd, ls, uname, and exit.\u001b[0m"
                                : "";
                    if (command === "exit") {
                      ws.send(
                        JSON.stringify({
                          type: "closed",
                          message: "Shell session ended.",
                        }),
                      );
                      ws.close();
                      return;
                    }
                    send(`\r\n${output ? output + "\r\n" : ""}${prompt}`);
                  } else if (character === "\u007f") {
                    if (input) {
                      input = input.slice(0, -1);
                      send("\b \b");
                    }
                  } else if (character === "\u0003") {
                    input = "";
                    send(`^C\r\n${prompt}`);
                  } else if (character >= " " && input.length < 4096) {
                    input += character;
                    send(character);
                  }
                }
              }
            } catch {
              ws.close();
            }
          });
        });
      });
      server.on("close", () => {
        for (const ws of wss.clients) ws.terminate();
        wss.close();
      });
    },
  };
}
