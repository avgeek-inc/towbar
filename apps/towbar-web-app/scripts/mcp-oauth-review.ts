import { createServer, request as proxyRequest } from "node:http";
import { connect } from "node:net";
import { createFixtureApiServer } from "./fixture-api.ts";
import { fixtureJson } from "./fixture-localization.ts";

// Local visual review only: no OAuth credentials are created or exchanged.
const fixture = createFixtureApiServer();
const fixtureHandler = fixture.listeners("request")[0]!;
const nextPort = 4038;
const host = process.argv.includes("--ipv4") ? "127.0.0.1" : "::1";
const empty = process.argv.includes("--empty-keys");
const createdAt = new Date().toISOString();
const expiresAt = new Date(Date.now() + 30 * 86400_000).toISOString();
const baseKey = {
  scope: "personal",
  access: "read",
  includeAdmin: false,
  grants: ["read"],
  prefix: "twb_review",
  ownerUserId: "review-user",
  createdAt,
  expiresAt,
  lastUsedAt: null,
  revokedAt: null,
};
const keys = [
  {
    ...baseKey,
    id: "review-chatgpt",
    name: "ChatGPT",
    tokenType: "mcp-oauth",
    oauthClientName: "ChatGPT",
    oauthClientLogo: "openai",
    oauthClientId: "https://chatgpt.com/mcp/client.json",
    oauthClientTrust: "metadata-document",
  },
  {
    ...baseKey,
    id: "review-unknown",
    name: "Desktop assistant",
    tokenType: "mcp-oauth",
    oauthClientName: "Desktop assistant",
    oauthClientLogo: null,
    oauthClientId: "review-unverified-app",
    oauthClientTrust: "unverified",
  },
  {
    ...baseKey,
    id: "review-legacy",
    name: "CI automation",
    tokenType: "api-key",
    expiresAt: null,
  },
];
const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost:4420");
  const send = (body: unknown, status = 200) => {
    res.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    res.end(fixtureJson(res, body));
  };
  if (url.pathname.startsWith("/v1/oauth/consent/")) {
    const state = url.pathname.split("/").at(-1);
    if (state === "expired")
      return send(
        {
          error_description:
            "This connection link has expired or was already used. Start again from your app.",
        },
        400,
      );
    if (state === "signed-out") return send({}, 401);
    if (req.method === "POST")
      return send(
        {
          error_description:
            "Review fixture: no access was granted. Start again from your app.",
        },
        400,
      );
    const unknown = state === "unknown";
    return send({
      clientName: unknown ? "Desktop assistant" : "ChatGPT",
      clientId: unknown
        ? "review-unverified-app"
        : "https://chatgpt.com/mcp/client.json",
      clientLogo: unknown ? null : "openai",
      clientTrust: unknown ? "unverified" : "metadata-document",
      redirectUri: unknown
        ? "http://127.0.0.1:51873/callback"
        : "https://chatgpt.com/connector/oauth/callback",
      scope:
        state === "edit" || state === "viewer"
          ? "mcp:read mcp:write"
          : "mcp:read",
      user: {
        name: "Alex Morgan",
        email: "alex@example.com",
        teamName: "Example workspace",
        role: state === "viewer" ? "viewer" : "admin",
      },
    });
  }
  if (
    url.pathname === "/v1/core/settings/api-keys/personal" &&
    req.method === "GET"
  ) {
    return send({
      keys: empty ? [] : keys,
      apiUrl: "https://towbar.example/v1/api",
      mcpUrl: "https://towbar.example/v1/mcp",
      rateLimit: { requests: 60, windowSeconds: 60 },
    });
  }
  if (url.pathname.startsWith("/v1/")) {
    delete req.headers.origin;
    fixtureHandler(req, res);
    return;
  }
  const upstream = proxyRequest(
    {
      hostname: "127.0.0.1",
      port: nextPort,
      path: req.url,
      method: req.method,
      headers: req.headers,
    },
    (response) => {
      res.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(res);
    },
  );
  upstream.on("error", () => {
    res.writeHead(502);
    res.end("Start the Next review server on port " + nextPort);
  });
  req.pipe(upstream);
});
server.on("upgrade", (req, socket, head) => {
  const upstream = connect(nextPort, "127.0.0.1", () => {
    upstream.write(
      `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${Object.entries(
        req.headers,
      )
        .map(([name, value]) => `${name}: ${value}`)
        .join("\r\n")}\r\n\r\n`,
    );
    upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
});
server.listen(4420, host, () =>
  console.info(
    "OAuth review: http://localhost:4420/oauth/consent?request=review",
  ),
);
