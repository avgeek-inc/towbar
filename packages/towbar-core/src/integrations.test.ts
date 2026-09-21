import assert from "node:assert/strict";
import test from "node:test";
import { integrationProviderSchema } from "./integrations.js";

void test("removed integration providers stay outside the public provider contract", () => {
  for (const provider of [
    "signoz",
    "splunk",
    "honeycomb",
    "mezmo",
    "fluentBit",
    "awsSecretsManager",
  ])
    assert.equal(integrationProviderSchema.safeParse(provider).success, false);
});
