import assert from "node:assert/strict";
import { test } from "node:test";

import { canShowApiMcpSettings, config } from "./config";
import { publicApiOrigin } from "./public-api-origin";

test("runtime API origin is independent of the dashboard origin", () => {
  const original = process.env.TOWBAR_API_BASE_URL;
  try {
    process.env.TOWBAR_API_BASE_URL = "https://towbar-api.avgeek.ltd";
    assert.equal(config.apiBaseUrl, "https://towbar-api.avgeek.ltd");
    process.env.TOWBAR_API_BASE_URL = "https://another-api.example";
    assert.equal(config.apiBaseUrl, "https://another-api.example");
  } finally {
    if (original === undefined) delete process.env.TOWBAR_API_BASE_URL;
    else process.env.TOWBAR_API_BASE_URL = original;
  }
});

test("browser requests use the runtime API metadata and fail closed if it is absent", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  let content: string | undefined = "https://towbar-api.avgeek.ltd";
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      querySelector(selector: string) {
        assert.equal(selector, 'meta[name="towbar-api-origin"]');
        return content ? { content } : null;
      },
    },
  });
  try {
    assert.equal(config.apiBaseUrl, "https://towbar-api.avgeek.ltd");
    content = undefined;
    assert.throws(() => config.apiBaseUrl, /public API origin is missing/);
  } finally {
    if (original) Object.defineProperty(globalThis, "document", original);
    else Reflect.deleteProperty(globalThis, "document");
  }
});

test("public API configuration rejects credentials, paths, and insecure remote origins", () => {
  for (const origin of [
    "https://user:password@api.example",
    "https://api.example/path",
    "https://api.example?token=value",
    "http://api.example",
  ])
    assert.throws(() => publicApiOrigin(origin));
  assert.equal(
    publicApiOrigin("http://localhost:4020"),
    "http://localhost:4020",
  );
});

test("API and MCP settings appear over HTTPS or in the local UI fixture", () => {
  assert.equal(
    canShowApiMcpSettings("https://towbar.example.com", false),
    true,
  );
  assert.equal(canShowApiMcpSettings("http://127.0.0.1:4420", true), true);
  assert.equal(canShowApiMcpSettings("http://localhost:4420", true), true);
});

test("HTTP installations cannot expose API and MCP settings", () => {
  assert.equal(canShowApiMcpSettings("http://127.0.0.1:4420", false), false);
  assert.equal(canShowApiMcpSettings("http://127.0.0.1:4021", true), false);
  assert.equal(
    canShowApiMcpSettings("http://towbar.example.com:4420", true),
    false,
  );
});

test("the isolated public demo can show simulated API and MCP settings over local HTTP", () => {
  assert.equal(
    canShowApiMcpSettings("http://localhost:4880", false, true),
    true,
  );
  assert.equal(
    canShowApiMcpSettings("http://localhost:4021", false, true),
    true,
  );
  assert.equal(
    canShowApiMcpSettings("http://localhost:4880", false, false),
    false,
  );
});
