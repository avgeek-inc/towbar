import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  originHealthCurlArguments,
  originHealthFailureMessage,
} from "./endpoint-health.js";
import { CommandError } from "./process.js";

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

  void it("surfaces the final curl failure without unbounded output", () => {
    const message = originHealthFailureMessage(
      new CommandError(
        "curl exited unsuccessfully",
        "",
        `ignored\ncurl: (60) ${"x".repeat(500)}`,
      ),
    );
    assert.match(message, /curl: \(60\)/);
    assert.ok(message.length <= 345);
  });
});
