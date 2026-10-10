import assert from "node:assert/strict";
import test from "node:test";
import {
  artifactNames,
  identity,
  sha256,
  validateImages,
  validateRelease,
  verifyPublicRelease,
} from "./release.mjs";

const release = {
  schemaVersion: 1,
  version: "v2.0.30",
  commit: "a".repeat(40),
  createdAt: "2026-10-05T12:00:00Z",
  artifacts: Object.fromEntries(
    [...artifactNames, "SHA256SUMS"].map((name) => [name, sha256(name)]),
  ),
};

test("public GitHub release assets are verified against every checksum", async () => {
  const requested = [];
  await verifyPublicRelease(release, async (url) => {
    requested.push(url);
    return url.endsWith("/release.json")
      ? Response.json({ ...release, validated: true })
      : new Response(url.split("/").at(-1));
  });
  assert.deepEqual(
    requested,
    ["release.json", ...Object.keys(release.artifacts)].map(
      (name) =>
        `https://github.com/${identity.repository}/releases/download/${release.version}/${name}`,
    ),
  );
  for (const response of [
    new Response("corrupt"),
    new Response(null, { status: 404 }),
  ]) {
    await assert.rejects(
      verifyPublicRelease(release, async (url) =>
        url.endsWith("/release.json")
          ? Response.json({ ...release, validated: true })
          : response,
      ),
      /verification/,
    );
  }
});

test("anonymous verification rejects changed or unvalidated release metadata", async () => {
  for (const change of [{ validated: false }, { commit: "b".repeat(40) }])
    await assert.rejects(
      verifyPublicRelease(release, async () =>
        Response.json({ ...release, validated: true, ...change }),
      ),
      /metadata differs/,
    );
});

test("release metadata requires the complete asset set and a stable identity", () => {
  validateRelease(release);
  for (const change of [
    { version: "v2.0.30-rc.1" },
    { commit: "not-a-commit" },
    { artifacts: { "source.tar.gz": sha256("source") } },
    { createdAt: "invalid" },
  ])
    assert.throws(
      () => validateRelease({ ...release, ...change }),
      /Invalid release/,
    );
});

test("image validation uses explicit registry identity independently of GitHub owner", () => {
  const images = {
    version: release.version,
    commit: release.commit,
    images: Object.fromEntries(
      ["api", "worker", "web-app"].map((service) => [
        service,
        `${identity.imageRegistry}/towbar-${service}@sha256:${"b".repeat(64)}`,
      ]),
    ),
  };
  validateImages(images, release);
  images.images.api = images.images.api.replace("@sha256:", ":");
  assert.throws(() => validateImages(images, release), /immutable/);
});
