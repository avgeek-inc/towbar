import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { originHealthCurlArguments } from "./endpoint-health.js";

void describe("direct origin health checks", () => {
  void it("pins the hostname and SNI to an IPv4 origin", () => {
    const args = originHealthCurlArguments(
      "192.0.2.10",
      "app.example.com",
      "/health",
    );
    assert.ok(args.includes("app.example.com:443:192.0.2.10"));
    assert.equal(args.at(-1), "https://app.example.com/health");
  });

  void it("brackets an IPv6 origin for curl --resolve", () => {
    const args = originHealthCurlArguments(
      "2001:db8::10",
      "app.example.com",
      "/health",
    );
    assert.ok(args.includes("app.example.com:443:[2001:db8::10]"));
  });
});
