import assert from "node:assert/strict";
import test from "node:test";

import { parseCandidatePort } from "./candidate-port.js";

void test("accepts a portless background resource", () => {
  assert.equal(parseCandidatePort("0\n", false), 0);
});

void test("requires a positive port for HTTP-capable deployables", () => {
  assert.throws(
    () => parseCandidatePort("0\n", true),
    /did not report a candidate port/u,
  );
  assert.equal(parseCandidatePort("49152\n", true), 49_152);
});
