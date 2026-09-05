import assert from "node:assert/strict";
import test from "node:test";

import { createAwsSdkCredentials } from "./service.js";

const payload = {
  accessKeyId: "AKIAEXAMPLE123456",
  secretAccessKey: "example-secret-access-key-value",
};

void test("isolates stored credentials from AWS SDK mutation", () => {
  const sdkCredentials = createAwsSdkCredentials(payload);
  Object.assign(sdkCredentials, { $source: { CREDENTIALS_CODE: "e" } });
  assert.deepEqual(payload, {
    accessKeyId: "AKIAEXAMPLE123456",
    secretAccessKey: "example-secret-access-key-value",
  });
});
