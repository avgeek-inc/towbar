import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { gzipSync } from "node:zlib";

import {
  createExpandedArchiveLimit,
  createSourceArchiveLimit,
  inspectSourceArchive,
} from "./source-fetch.js";

void describe("source archive size limit", () => {
  void it("passes an archive within the configured limit", async () => {
    const chunks: Buffer[] = [];
    const sink = createSourceArchiveLimit(5);
    sink.on("data", (chunk: Buffer) => chunks.push(chunk));

    await pipeline(Readable.from([Buffer.from("12345")]), sink);

    assert.equal(Buffer.concat(chunks).toString(), "12345");
  });

  void it("rejects an archive that crosses the configured limit", async () => {
    await assert.rejects(
      pipeline(
        Readable.from([Buffer.from("123"), Buffer.from("456")]),
        createSourceArchiveLimit(5),
      ),
      /exceeds the 5-byte safety limit/,
    );
  });

  void it("rejects a small gzip that expands beyond the checkout limit", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "towbar-archive-"));
    const archivePath = path.join(directory, "source.tar.gz");
    try {
      await writeFile(archivePath, gzipSync(Buffer.alloc(4_096)));
      await assert.rejects(
        inspectSourceArchive(archivePath, {
          maxBytes: 1_024,
          maxEntries: 10,
        }),
        /Expanded source archive exceeds the 1024-byte safety limit/u,
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  void it("rejects archives with too many entries", async () => {
    await assert.rejects(
      pipeline(
        Readable.from([tarHeader("one"), tarHeader("two")]),
        createExpandedArchiveLimit({ maxBytes: 2_048, maxEntries: 1 }),
      ),
      /exceeds the 1-entry safety limit/u,
    );
  });

  void it("accepts an expanded archive within both limits", async () => {
    await pipeline(
      Readable.from([
        tarHeader("one", 3),
        Buffer.concat([Buffer.from("abc"), Buffer.alloc(509)]),
        Buffer.alloc(1_024),
      ]),
      createExpandedArchiveLimit({ maxBytes: 2_048, maxEntries: 1 }),
    );
  });
});

function tarHeader(name: string, size = 0) {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write(size.toString(8).padStart(11, "0"), 124, 11, "ascii");
  return header;
}
