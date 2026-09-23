import assert from "node:assert/strict";

import { getInstanceSecretReadiness } from "../apps/secrets.js";
import {
  type SecretSlot,
  mutateSecret,
  readSecretMetadata,
} from "../secrets/store.js";

export async function assertDeclaredSecretValueCanBeCleared(input: {
  appId: string;
  slot: SecretSlot;
  userId: string;
  workspaceId: string;
}) {
  assert.deepEqual(
    await getInstanceSecretReadiness({
      appId: input.appId,
      workspaceId: input.workspaceId,
    }),
    { ready: true },
  );
  const configured = await readSecretMetadata(input.slot);
  await mutateSecret(
    input.slot,
    {
      expectedRevision: configured.revision,
      set: {},
      delete: ["TOKEN"],
    },
    input.userId,
  );
  assert.deepEqual((await readSecretMetadata(input.slot)).missingKeys, [
    "TOKEN",
  ]);
  assert.deepEqual(
    await getInstanceSecretReadiness({
      appId: input.appId,
      workspaceId: input.workspaceId,
    }),
    { ready: false },
  );
  const cleared = await readSecretMetadata(input.slot);
  await mutateSecret(
    input.slot,
    {
      expectedRevision: cleared.revision,
      set: { TOKEN: "stage-value" },
      delete: [],
    },
    input.userId,
  );
}
