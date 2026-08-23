import assert from "node:assert/strict";
import test from "node:test";

import {
  createAwsSdkCredentials,
  parseStoredAwsCredentialPayload,
} from "./service.js";

const payload = {
  accessKeyId: "AKIAEXAMPLE123456",
  secretAccessKey: "example-secret-access-key-value",
};

void test("strips AWS SDK credential source metadata from stored credentials", () => {
  assert.deepEqual(
    parseStoredAwsCredentialPayload({
      ...payload,
      $source: { CREDENTIALS_CODE: "e" },
    }),
    payload,
  );
});

void test("continues to reject unknown stored credential fields", () => {
  assert.throws(
    () =>
      parseStoredAwsCredentialPayload({
        ...payload,
        unexpected: true,
      }),
    /Unrecognized key/u,
  );
});

void test("isolates stored credentials from AWS SDK mutation", () => {
  const sdkCredentials = createAwsSdkCredentials(payload);
  Object.assign(sdkCredentials, { $source: { CREDENTIALS_CODE: "e" } });
  assert.deepEqual(payload, {
    accessKeyId: "AKIAEXAMPLE123456",
    secretAccessKey: "example-secret-access-key-value",
  });
});
