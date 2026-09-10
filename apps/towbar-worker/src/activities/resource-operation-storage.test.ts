import assert from "node:assert/strict";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { azureBlobStorage } from "./resource-operation-storage.js";

void test("Azure single and chunked uploads use valid metadata and round-trip verification", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "towbar-azure-test-"));
  const file = join(directory, "backup");
  const metadata = {
    "towbar-checksum": "abc",
    "towbar-engine": "postgres",
    "towbar-engine-major-version": "17",
    "towbar-format": "postgres-custom",
    "towbar-metadata-version": "1",
  };
  let saved = new Headers();
  let blockUploads = 0;
  let size = 10;
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string, options: RequestInit) => {
      if (url.includes("login.microsoftonline.com"))
        return Response.json({ access_token: "token" });
      const headers = new Headers(options.headers);
      if (options.method === "HEAD") {
        return new Response(null, {
          headers: new Headers([
            ...saved,
            ["content-length", String(size)],
            ["x-ms-server-encrypted", "true"],
          ]),
        });
      }
      if (url.includes("comp=block&")) {
        blockUploads++;
        return new Response(null, { status: 201 });
      }
      saved = new Headers(
        [...headers].filter(([key]) => key.startsWith("x-ms-meta-")),
      );
      assert.equal([...saved].length, 5);
      for (const [key] of saved)
        assert.match(
          key.slice("x-ms-meta-".length),
          /^[A-Za-z_][A-Za-z0-9_]*$/,
        );
      if (options.body instanceof ReadableStream)
        await new Response(options.body).arrayBuffer();
      return new Response(null, { status: 201 });
    },
  );
  try {
    const storage = azureBlobStorage(
      { clientId: "test", clientSecret: "test", tenantId: "test" },
      "storageacct",
    );
    for (size of [10, 257 * 1024 * 1024]) {
      const handle = await open(file, "w");
      await handle.truncate(size);
      await handle.close();
      await storage.upload({
        bucket: "backups",
        key: "dump",
        localPath: file,
        metadata,
        sizeBytes: size,
        encryption: "Microsoft-managed",
      });
      assert.deepEqual(
        await storage.headObject({ bucket: "backups", key: "dump" }),
        {
          checksum: "abc",
          encryption: "Microsoft-managed",
          engine: "postgres",
          engineMajorVersion: 17,
          exists: true,
          format: "postgres-custom",
          metadataVersion: 1,
          sizeBytes: size,
        },
      );
    }
    assert(blockUploads > 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
