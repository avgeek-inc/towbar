import assert from "node:assert/strict";
import { test } from "node:test";

import { canShowApiMcpSettings } from "./config";

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
