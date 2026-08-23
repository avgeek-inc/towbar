import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  reconcileCloudflareDns,
  verifyCloudflareTlsMode,
} from "./cloudflare.js";

function jsonResponse(result: unknown, status = 200) {
  return new Response(JSON.stringify({ result, success: status < 400 }), {
    headers: { "content-type": "application/json" },
    status,
  });
}

void describe("Cloudflare DNS reconciliation", () => {
  void it("discovers the zone and creates orange-cloud address records", async () => {
    const mutations: Array<{ body: unknown; method: string; url: string }> = [];
    const fetcher: typeof fetch = (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/client/v4/zones") {
        return Promise.resolve(
          jsonResponse(
            url.searchParams.get("name") === "towbar.dev"
              ? [{ id: "zone-id", name: "towbar.dev" }]
              : [],
          ),
        );
      }
      if (init?.method === "POST") {
        mutations.push({
          body: JSON.parse(String(init.body)) as unknown,
          method: init.method,
          url: url.pathname,
        });
        return Promise.resolve(jsonResponse({ id: "record-id" }));
      }
      return Promise.resolve(jsonResponse([]));
    };

    await reconcileCloudflareDns({
      apiToken: "cloudflare-test-token",
      appId: "towbar-website",
      domains: ["towbar.dev", "www.towbar.dev"],
      fetcher,
      serverIp: "192.0.2.10",
    });

    assert.equal(mutations.length, 2);
    for (const mutation of mutations) {
      const body = mutation.body as Record<string, unknown>;
      assert.equal(mutation.method, "POST");
      assert.deepEqual(mutation.body, {
        comment: "Managed by Towbar: towbar-website",
        content: "192.0.2.10",
        name: body.name,
        proxied: true,
        ttl: 1,
        type: "A",
      });
    }
  });

  void it("refuses to overwrite an unrelated record", async () => {
    const fetcher: typeof fetch = (input) => {
      const url = new URL(String(input));
      return Promise.resolve(
        url.pathname === "/client/v4/zones"
          ? jsonResponse([{ id: "zone-id", name: "towbar.dev" }])
          : jsonResponse([
              {
                content: "192.0.2.20",
                id: "manual-record",
                name: "towbar.dev",
                proxied: false,
                type: "A",
              },
            ]),
      );
    };

    await assert.rejects(
      reconcileCloudflareDns({
        apiToken: "cloudflare-test-token",
        appId: "towbar-website",
        domains: ["towbar.dev"],
        fetcher,
        serverIp: "192.0.2.10",
      }),
      /not managed by Towbar/u,
    );
  });

  void it("refuses to take over a record owned by another Towbar app", async () => {
    let mutated = false;
    const fetcher: typeof fetch = (input, init) => {
      const url = new URL(String(input));
      if (init?.method) mutated = true;
      return Promise.resolve(
        url.pathname === "/client/v4/zones"
          ? jsonResponse([{ id: "zone-id", name: "towbar.dev" }])
          : jsonResponse([
              {
                comment: "Managed by Towbar: towbar-api",
                content: "192.0.2.10",
                id: "managed-record",
                name: "api.towbar.dev",
                proxied: true,
                type: "A",
              },
            ]),
      );
    };

    await assert.rejects(
      reconcileCloudflareDns({
        apiToken: "cloudflare-test-token",
        allowUnmanagedAdoption: true,
        appId: "another-app",
        domains: ["api.towbar.dev"],
        fetcher,
        serverIp: "192.0.2.10",
      }),
      /owned by another Towbar app/u,
    );
    assert.equal(mutated, false);
  });

  void it("updates a record only when the same app already owns it", async () => {
    const mutations: Array<{ body: unknown; method: string }> = [];
    const fetcher: typeof fetch = (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/client/v4/zones") {
        return Promise.resolve(
          jsonResponse([{ id: "zone-id", name: "towbar.dev" }]),
        );
      }
      if (init?.method === "PUT") {
        mutations.push({
          body: JSON.parse(String(init.body)) as unknown,
          method: init.method,
        });
        return Promise.resolve(jsonResponse({ id: "managed-record" }));
      }
      return Promise.resolve(
        jsonResponse([
          {
            comment: "Managed by Towbar: towbar-api",
            content: "192.0.2.10",
            id: "managed-record",
            name: "api.towbar.dev",
            proxied: true,
            type: "A",
          },
        ]),
      );
    };

    await reconcileCloudflareDns({
      apiToken: "cloudflare-test-token",
      appId: "towbar-api",
      domains: ["api.towbar.dev"],
      fetcher,
      serverIp: "192.0.2.20",
    });
    assert.equal(mutations.length, 1);
    assert.equal(mutations[0]?.method, "PUT");
  });

  void it("adopts an unmanaged same-target record only when explicitly allowed", async () => {
    const mutations: string[] = [];
    const fetcher: typeof fetch = (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/client/v4/zones") {
        return Promise.resolve(
          jsonResponse([{ id: "zone-id", name: "towbar.dev" }]),
        );
      }
      if (init?.method === "PUT") {
        mutations.push(init.method);
        return Promise.resolve(jsonResponse({ id: "legacy-record" }));
      }
      return Promise.resolve(
        jsonResponse([
          {
            content: "192.0.2.10",
            id: "legacy-record",
            name: "towbar.dev",
            proxied: true,
            type: "A",
          },
        ]),
      );
    };

    await assert.rejects(
      reconcileCloudflareDns({
        apiToken: "cloudflare-test-token",
        appId: "towbar-website",
        domains: ["towbar.dev"],
        fetcher,
        serverIp: "192.0.2.10",
      }),
      /not managed by Towbar/u,
    );
    await reconcileCloudflareDns({
      apiToken: "cloudflare-test-token",
      allowUnmanagedAdoption: true,
      appId: "towbar-website",
      domains: ["towbar.dev"],
      fetcher,
      serverIp: "192.0.2.10",
    });
    assert.deepEqual(mutations, ["PUT"]);
  });

  void it("requires Full (strict) mode on every affected zone", async () => {
    const fetcher: typeof fetch = (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/client/v4/zones") {
        return Promise.resolve(
          jsonResponse([{ id: "zone-id", name: "towbar.dev" }]),
        );
      }
      return Promise.resolve(jsonResponse({ value: "strict" }));
    };
    await verifyCloudflareTlsMode({
      apiToken: "cloudflare-test-token",
      domains: ["towbar.dev", "www.towbar.dev"],
      fetcher,
    });
  });

  void it("rejects Flexible and Full modes", async () => {
    const fetcher: typeof fetch = (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/client/v4/zones") {
        return Promise.resolve(
          jsonResponse([{ id: "zone-id", name: "towbar.dev" }]),
        );
      }
      return Promise.resolve(jsonResponse({ value: "full" }));
    };
    await assert.rejects(
      verifyCloudflareTlsMode({
        apiToken: "cloudflare-test-token",
        domains: ["towbar.dev"],
        fetcher,
      }),
      /Full \(strict\)/u,
    );
  });
});
