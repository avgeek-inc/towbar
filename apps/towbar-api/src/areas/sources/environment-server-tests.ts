import assert from "node:assert/strict";
import { normalizeServerConfiguration } from "@workspace/towbar-core";
import { createServer, updateServer } from "../servers/lifecycle.js";
export async function assertServerSlugEditing(workspaceId: string) {
  const extraConfig = normalizeServerConfiguration({
    ip: "192.0.2.11",
    ssh: { username: "deploy" },
  });
  const extra = await createServer({
    workspaceId,
    slug: "extra-host",
    config: extraConfig,
  });
  await assert.rejects(
    updateServer({
      workspaceId,
      serverId: extra.id,
      slug: "host",
      config: extraConfig,
    }),
    /already in use/,
  );
  const renamed = await updateServer({
    workspaceId,
    serverId: extra.id,
    slug: "renamed-host",
    config: extraConfig,
  });
  assert.equal(renamed.slug, "renamed-host");
  assert.deepEqual(renamed.config, extraConfig);
}
