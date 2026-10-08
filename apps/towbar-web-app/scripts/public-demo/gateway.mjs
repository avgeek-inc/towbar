import { Buffer } from "node:buffer";
import { randomBytes, createHmac } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { isIP } from "node:net";
import { Worker } from "node:worker_threads";
import { allowsFixtureRequest } from "./policy.mjs";

const minute = 60_000;
const bodyLimit = 16_384;
const securityHeaders = {
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow, noarchive",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "content-security-policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-src 'none'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'",
};

function json(response, status, data) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(data));
}
function fail(response, status, code, message) {
  json(response, status, { error: { code, message } });
}
function bucket(limit, duration, now) {
  return { remaining: limit, resetAt: now + duration };
}
function take(owner, key, limit, duration, now) {
  if (!owner[key] || owner[key].resetAt <= now)
    owner[key] = bucket(limit, duration, now);
  return owner[key].remaining-- > 0;
}
function normalizeIp(ip) {
  if (ip?.startsWith("::ffff:")) return ip.slice(7);
  return ip;
}
export function networkKey(ip) {
  if (isIP(ip) !== 6) return ip;
  // Canonicalize compressed IPv6 and group privacy addresses by /64.
  const canonical = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  const [left, right = ""] = canonical.split("::");
  const prefix = left ? left.split(":") : [];
  const suffix = right ? right.split(":") : [];
  return [
    ...prefix,
    ...Array(8 - prefix.length - suffix.length).fill("0"),
    ...suffix,
  ]
    .slice(0, 4)
    .join(":");
}

export function createDemoServer({
  origin,
  webPort = 4021,
  workerUrl = new URL("./worker.mjs", import.meta.url),
  ttlMs = 10 * minute,
  maxSessions = 4,
  startsPerNetwork = 12,
  now = Date.now,
} = {}) {
  const publicUrl = new URL(origin);
  if (
    publicUrl.origin !== origin ||
    publicUrl.username ||
    publicUrl.password ||
    (publicUrl.protocol !== "https:" &&
      !["http://127.0.0.1", "http://localhost"].some(
        (local) =>
          publicUrl.origin === local ||
          publicUrl.origin.startsWith(`${local}:`),
      ))
  )
    throw new Error(
      "Demo origin must be an HTTPS origin or loopback HTTP origin",
    );
  const secure = publicUrl.protocol === "https:";
  const cookieName = secure ? "__Host-towbar-demo" : "towbar-demo-local";
  const sessions = new Map();
  const networks = new Map();
  const networkSalt = randomBytes(32);
  const globalLimits = {};
  let stopping = false;

  function setCookie(response, token, age = ttlMs / 1000) {
    response.setHeader(
      "set-cookie",
      `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(age)}${secure ? "; Secure" : ""}`,
    );
  }
  function getSession(request) {
    const matches = (request.headers.cookie ?? "")
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part.startsWith(`${cookieName}=`));
    if (matches.length !== 1) return;
    const token = matches[0].slice(cookieName.length + 1);
    const session = /^[a-f0-9]{64}$/.test(token)
      ? sessions.get(token)
      : undefined;
    if (session && session.expiresAt <= now()) {
      void dispose(session);
      return;
    }
    return session;
  }
  async function dispose(session) {
    sessions.delete(session.token);
    clearTimeout(session.expiry);
    for (const pending of session.requests) pending.destroy();
    await session.worker.terminate();
  }
  const sweep = setInterval(() => {
    for (const [key, value] of networks)
      if (value.lastSeen + 10 * minute <= now()) networks.delete(key);
  }, minute).unref();

  async function startSession() {
    const token = randomBytes(32).toString("hex");
    const worker = new Worker(workerUrl, {
      env: {},
      execArgv: [],
      resourceLimits: {
        maxOldGenerationSizeMb: 64,
        maxYoungGenerationSizeMb: 16,
        stackSizeMb: 4,
      },
    });
    const session = {
      token,
      worker,
      expiresAt: now() + ttlMs,
      requests: new Set(),
      mutations: 0,
      inFlight: 0,
      streams: 0,
    };
    sessions.set(token, session); // Reserve capacity before asynchronous startup.
    worker.on("error", () => {
      void dispose(session);
    });
    worker.on("exit", () => {
      void dispose(session);
    });
    session.expiry = setTimeout(() => {
      void dispose(session);
    }, ttlMs).unref();
    try {
      session.port = await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Fixture startup timed out")),
          10_000,
        );
        worker.once("message", ({ port }) => {
          clearTimeout(timeout);
          resolve(port);
        });
        worker.once("error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        worker.once("exit", () => {
          clearTimeout(timeout);
          reject(new Error("Fixture exited"));
        });
      });
      if (!sessions.has(token))
        throw new Error("Session expired during startup");
      return session;
    } catch (error) {
      await dispose(session);
      throw error;
    }
  }

  function proxy(request, response, port, body, session) {
    const headers = {};
    // No caller cookies, auth, forwarding, proxy, or connection headers cross the boundary.
    const allowedHeaders = session
      ? ["accept", "content-type", "last-event-id"]
      : [
          "accept",
          "rsc",
          "next-router-state-tree",
          "next-router-prefetch",
          "next-router-segment-prefetch",
          "next-url",
        ];
    for (const name of allowedHeaders)
      if (request.headers[name]) headers[name] = request.headers[name];
    if (body.length) headers["content-length"] = body.length;
    headers.host = publicUrl.host;
    const upstream = httpRequest(
      {
        hostname: "127.0.0.1",
        port,
        path: request.url,
        method: request.method,
        headers,
      },
      (incoming) => {
        // Next's segment cache needs these markers as well as its Flight body.
        const responseHeaders = [
          "content-type",
          "content-encoding",
          "vary",
          ...(!session
            ? [
                "x-nextjs-stale-time",
                "x-nextjs-prerender",
                "x-nextjs-postponed",
              ]
            : []),
        ];
        for (const name of responseHeaders)
          if (incoming.headers[name])
            response.setHeader(name, incoming.headers[name]);
        const location = incoming.headers.location;
        if (location && location.startsWith("/") && !location.startsWith("//"))
          response.setHeader("location", location);
        response.writeHead(incoming.statusCode ?? 502);
        incoming.on("error", () => response.destroy());
        incoming.pipe(response);
      },
    );
    session?.requests.add(upstream);
    upstream.setTimeout(30_000, () => upstream.destroy());
    upstream.on("error", () => {
      if (!response.headersSent)
        fail(
          response,
          502,
          "DEMO_UNAVAILABLE",
          "Your demo stopped. Start again to keep exploring.",
        );
      else response.destroy();
    });
    response.on("close", () => {
      upstream.destroy();
      session?.requests.delete(upstream);
    });
    upstream.end(body);
  }

  async function handle(request, response) {
    for (const [key, value] of Object.entries(securityHeaders))
      response.setHeader(key, value);
    if (secure)
      response.setHeader("strict-transport-security", "max-age=31536000");
    if (request.url === "/health" && request.method === "GET") {
      json(response, stopping ? 503 : 200, {
        status: stopping ? "stopping" : "ok",
        mode: "public-demo",
      });
      return;
    }
    if (stopping)
      return fail(
        response,
        503,
        "DEMO_UNAVAILABLE",
        "The demo is restarting. Try again shortly.",
      );
    if (request.headers.host !== publicUrl.host)
      return fail(
        response,
        421,
        "INVALID_HOST",
        "Use the demo's public address.",
      );
    if (
      !request.url?.startsWith("/") ||
      request.url.startsWith("//") ||
      request.url.length > 4096 ||
      /[%\\]/.test(request.url.split("?")[0])
    )
      return fail(response, 400, "INVALID_PATH", "Invalid demo request path.");
    const url = new URL(request.url, origin);
    const path = url.pathname;
    if (path !== request.url.split("?")[0])
      return fail(response, 400, "INVALID_PATH", "Invalid demo request path.");
    const method = request.method;
    const mutation = !["GET", "HEAD"].includes(method);
    if (
      (request.headers.origin && request.headers.origin !== origin) ||
      (mutation && request.headers.origin !== origin) ||
      request.headers["sec-fetch-site"] === "cross-site"
    )
      return fail(
        response,
        403,
        "DEMO_ORIGIN",
        "Open the demo in its own tab and try again.",
      );
    const clientIp = normalizeIp(request.socket.remoteAddress);
    const key = createHmac("sha256", networkSalt)
      .update(networkKey(clientIp))
      .digest("hex");
    if (!networks.has(key)) {
      if (networks.size >= 4096)
        return fail(
          response,
          503,
          "DEMO_BUSY",
          "The demo is busy. Try again shortly.",
        );
      networks.set(key, {});
    }
    const network = networks.get(key);
    network.lastSeen = now();
    function limited() {
      response.setHeader("retry-after", "60");
      fail(
        response,
        429,
        "DEMO_RATE_LIMIT",
        "Too many demo requests. Wait a minute and try again.",
      );
    }
    if (
      !take(globalLimits, "requests", 6000, minute, now()) ||
      !take(network, "requests", 1800, minute, now())
    )
      return limited();
    let session = getSession(request);
    if (
      session &&
      (path.startsWith("/v1/") || path.startsWith("/__demo/")) &&
      !take(session, "rate", 360, minute, now())
    )
      return limited();
    if (path === "/__demo/session" && method === "GET") {
      json(response, 200, {
        active: !!session,
        expiresAt: session?.expiresAt ?? null,
      });
      return;
    }
    const start = path === "/__demo/start" && method === "POST";
    const reset = path === "/__demo/reset" && method === "POST";
    const end =
      (path === "/__demo/session" || path === "/v1/core/session") &&
      method === "DELETE";
    if (start || reset || end) {
      if (
        Number(request.headers["content-length"] ?? 0) > 0 ||
        request.headers["transfer-encoding"]
      )
        return fail(
          response,
          400,
          "INVALID_BODY",
          "Session controls do not accept a body.",
        );
      if (end) {
        if (session) await dispose(session);
        setCookie(response, "", 0);
        json(response, 200, { success: true });
        return;
      }
      if (reset && !session)
        return fail(
          response,
          401,
          "DEMO_EXPIRED",
          "Your demo ended. Start again to keep exploring.",
        );
      if (start && session) {
        json(response, 200, { expiresAt: session.expiresAt });
        return;
      }
      if (
        !take(network, "starts", startsPerNetwork, 10 * minute, now()) ||
        !take(globalLimits, "starts", 60, 10 * minute, now())
      )
        return limited();
      if (session) await dispose(session);
      if (sessions.size >= maxSessions)
        return fail(
          response,
          503,
          "DEMO_BUSY",
          "The demo is busy. Try again in a few minutes.",
        );
      session = await startSession();
      if (response.destroyed) {
        await dispose(session);
        return;
      }
      setCookie(response, session.token);
      json(response, 201, { expiresAt: session.expiresAt });
      return;
    }
    if (path.startsWith("/__demo/"))
      return fail(response, 404, "NOT_FOUND", "Unknown demo control.");
    if (path.startsWith("/v1/")) {
      if (!session)
        return fail(
          response,
          401,
          "DEMO_EXPIRED",
          "Your demo ended. Start again to keep exploring.",
        );
      if (!allowsFixtureRequest(method, path))
        return fail(
          response,
          403,
          "DEMO_RESTRICTED",
          "This action is unavailable in the demo. Explore the sample data or try a simulated deployment.",
        );
      const stream =
        method === "GET" &&
        /^\/v1\/core\/deployments\/[^/]+\/events$/.test(path);
      if (session.inFlight >= 48 || (stream && session.streams >= 8)) {
        response.setHeader("retry-after", "1");
        return fail(
          response,
          429,
          "DEMO_CONCURRENCY_LIMIT",
          "Too many open demo requests. Close extra demo tabs and retry.",
        );
      }
      session.inFlight++;
      if (stream) session.streams++;
      response.once("close", () => {
        session.inFlight--;
        if (stream) session.streams--;
      });
      const readHelper =
        method === "POST" &&
        (path === "/v1/core/date-time/localize" ||
          /^\/v1\/core\/profile\/preferences\/(preview|range(?:\/resolve)?)$/.test(
            path,
          ));
      if (mutation && !readHelper && ++session.mutations > 100)
        return fail(
          response,
          429,
          "DEMO_MUTATION_LIMIT",
          "You reached the demo’s change limit. Reset the demo to start fresh.",
        );
      let body = Buffer.alloc(0);
      if (mutation) {
        for await (const chunk of request) {
          if (body.length + chunk.length > bodyLimit) {
            fail(
              response,
              413,
              "BODY_TOO_LARGE",
              "Demo requests are limited to 16 KiB.",
            );
            return;
          }
          body = Buffer.concat([body, chunk]);
        }
        if (
          body.length &&
          request.headers["content-type"]?.split(";")[0] !== "application/json"
        )
          return fail(
            response,
            415,
            "INVALID_BODY",
            "Use a JSON request body.",
          );
        if (!body.length) body = Buffer.from("{}");
        try {
          JSON.parse(body.toString());
        } catch {
          return fail(
            response,
            400,
            "INVALID_BODY",
            "Use a valid JSON request body.",
          );
        }
      } else if (
        request.headers["transfer-encoding"] ||
        Number(request.headers["content-length"] ?? 0) > 0
      )
        return fail(
          response,
          400,
          "INVALID_BODY",
          "Read requests do not accept a body.",
        );
      if (!sessions.has(session.token))
        return fail(
          response,
          401,
          "DEMO_EXPIRED",
          "Your demo ended. Start again to keep exploring.",
        );
      proxy(request, response, session.port, body, session);
      return;
    }
    // Next serves UI only. Do not expose arbitrary API handlers or image fetching.
    if (
      !["GET", "HEAD"].includes(method) ||
      path.startsWith("/api/") ||
      path === "/api" ||
      path.startsWith("/_next/image")
    )
      return fail(
        response,
        403,
        "DEMO_RESTRICTED",
        "This endpoint is unavailable in the demo.",
      );
    const publicAsset =
      path.startsWith("/_next/static/") ||
      /^\/(brand|avatars|images|icons)\//.test(path) ||
      path === "/favicon.ico";
    if (
      (!session && path !== "/demo" && !publicAsset) ||
      ["/login", "/setup", "/forgot-password", "/reset-password"].includes(path)
    ) {
      response.writeHead(303, { location: "/demo" });
      response.end();
      return;
    }
    proxy(request, response, webPort, Buffer.alloc(0));
  }
  const server = createServer(
    { maxHeaderSize: 16_384, requestTimeout: 15_000, headersTimeout: 10_000 },
    (request, response) => {
      void handle(request, response).catch(() => {
        if (!response.headersSent)
          fail(
            response,
            503,
            "DEMO_UNAVAILABLE",
            "The demo is temporarily unavailable. Try again shortly.",
          );
        else response.destroy();
      });
    },
  );
  server.maxConnections = 256;
  server.on("upgrade", (_request, socket) =>
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"),
  );
  server.on("connect", (_request, socket) => socket.destroy());
  server.stopDemo = async () => {
    stopping = true;
    clearInterval(sweep);
    const closing = new Promise((resolve) => server.close(resolve));
    server.closeAllConnections();
    await Promise.all([...sessions.values()].map(dispose));
    await closing;
  };
  return server;
}
