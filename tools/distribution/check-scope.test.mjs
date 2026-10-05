import assert from "node:assert/strict";
import test from "node:test";
import { verifyCredentialScope } from "./check-scope.mjs";

const credentials = { bucket: "release-bucket", prefix: "towbar" };
test("publication preflight requires authorized reads and denied outside operations", async () => {
  const commands = [];
  await verifyCredentialScope(
    {
      async send(command) {
        commands.push(command);
        throw {
          $metadata: {
            httpStatusCode:
              command.constructor.name === "HeadObjectCommand" ? 404 : 403,
          },
        };
      },
    },
    credentials,
  );
  assert.match(commands[0].input.Key, /^towbar\//);
  assert.ok(
    commands
      .slice(1, 3)
      .every((command) => !command.input.Key.startsWith("towbar/")),
  );
  assert.equal(commands[2].input.IfNoneMatch, "*");
  assert.equal(commands[3].constructor.name, "ListObjectsV2Command");
});

test("publication preflight rejects invalid sessions, unexpected access and inconclusive errors", async () => {
  for (const failure of ["allowed", 404, 500, undefined]) {
    await assert.rejects(
      verifyCredentialScope(
        {
          async send(command) {
            if (command.constructor.name === "HeadObjectCommand")
              throw { $metadata: { httpStatusCode: 404 } };
            if (failure !== "allowed")
              throw { $metadata: { httpStatusCode: failure } };
          },
        },
        credentials,
      ),
      /unexpectedly permitted|expected HTTP 403/,
    );
  }
  await assert.rejects(
    verifyCredentialScope(
      {
        async send() {
          throw { $metadata: { httpStatusCode: 403 } };
        },
      },
      credentials,
    ),
    /expected HTTP 404/,
  );
});
