import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  artifactNames,
  identity,
  promoteRelease,
  putImmutable,
  sha256,
  uploadRelease,
  validateImages,
  verifyPublicRelease,
  verifyStableRelease,
} from "./release.mjs";

class Store {
  objects = new Map();
  writes = [];
  async get(key) {
    return this.objects.get(key) ?? null;
  }
  async put(key, body, options = {}) {
    const previous = this.objects.get(key);
    if (
      (options.ifNoneMatch === "*" && previous) ||
      (options.ifMatch && previous?.etag !== options.ifMatch)
    )
      throw Object.assign(new Error("Precondition failed"), {
        $metadata: { httpStatusCode: 412 },
      });
    const bytes = Buffer.from(body);
    this.objects.set(key, { body: bytes, etag: sha256(bytes) });
    this.writes.push(key);
  }
}
async function fixture(t, version = "v2.0.30") {
  const directory = await mkdtemp(join(tmpdir(), "towbar-distribution-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "schemas"));
  const release = {
    schemaVersion: 1,
    version,
    commit: "a".repeat(40),
    createdAt: "2026-10-05T12:00:00Z",
    artifacts: {},
  };
  const images = {
    version,
    commit: release.commit,
    images: Object.fromEntries(
      ["api", "worker", "web-app"].map((service) => [
        service,
        `${identity.imageRegistry}/towbar-${service}@sha256:${"b".repeat(64)}`,
      ]),
    ),
  };
  for (const name of [...artifactNames, "SHA256SUMS"]) {
    const body =
      name === "towbar-images.json"
        ? JSON.stringify(images)
        : `content of ${name}`;
    release.artifacts[name] = sha256(body);
    await writeFile(join(directory, name), body);
  }
  await writeFile(join(directory, "release.json"), JSON.stringify(release));
  const store = new Store();
  // Model public responses from the documented release-host contract.
  const fetcher = async (url) => {
    const path = url.slice(identity.distributionUrl.length + 1);
    const latest = await store.get(`${identity.releasePrefix}/latest.json`);
    const promoted = latest && JSON.parse(latest.body.toString());
    if (path === "releases/latest.json")
      return promoted
        ? Response.json(promoted)
        : new Response(null, { status: 404 });
    let key;
    if (path === "install.sh" || path.startsWith("schemas/")) {
      if (!promoted) return new Response(null, { status: 404 });
      key = `${identity.releasePrefix}/releases/${promoted.version}/${path}`;
    } else key = `${identity.releasePrefix}/${path}`;
    const object = await store.get(key);
    if (!object) return new Response(null, { status: 404 });
    if (path.endsWith("/release.json")) {
      const marker = await store.get(
        key.replace(/release.json$/, "validated.json"),
      );
      return Response.json(
        marker
          ? JSON.parse(marker.body.toString())
          : { ...JSON.parse(object.body.toString()), validated: false },
      );
    }
    return new Response(object.body);
  };
  await uploadRelease(store, directory);
  return { directory, release, store, fetcher };
}
test("uploads are resumable only when immutable bytes match", async () => {
  const store = new Store();
  await putImmutable(store, "artifact", Buffer.from("first"));
  await putImmutable(store, "artifact", Buffer.from("first"));
  await assert.rejects(
    putImmutable(store, "artifact", Buffer.from("changed")),
    /different content/,
  );
  assert.equal(store.objects.get("artifact").body.toString(), "first");
});
test("upload validates every checksum and publishes the manifest last", async (t) => {
  const { store, directory } = await fixture(t);
  assert.match(store.writes.at(-1), /release.json$/);
  await writeFile(join(directory, "source.tar.gz"), "corrupted");
  const empty = new Store();
  await assert.rejects(uploadRelease(empty, directory), /Checksum mismatch/);
  assert.equal(empty.writes.length, 0);
});
test("candidate releases do not change latest or installer; promotion uses one validated pointer", async (t) => {
  const { release, store, fetcher } = await fixture(t);
  await assert.rejects(verifyStableRelease(release, fetcher), /unavailable/);
  assert.equal(
    (await fetcher(`${identity.distributionUrl}/install.sh`)).status,
    404,
  );
  const before = await fetcher(
    `${identity.distributionUrl}/releases/${release.version}/release.json`,
  );
  assert.equal((await before.json()).validated, false);
  await verifyPublicRelease(release, fetcher);
  await promoteRelease(store, release, fetcher);
  await verifyStableRelease(release, fetcher);
  const latest = await fetcher(
    `${identity.distributionUrl}/releases/latest.json`,
  );
  assert.deepEqual(await latest.json(), { ...release, validated: true });
  const installer = await fetcher(`${identity.distributionUrl}/install.sh`);
  assert.equal(await installer.text(), "content of install.sh");
  assert.equal(
    (
      await (
        await fetcher(
          `${identity.distributionUrl}/releases/${release.version}/release.json`,
        )
      ).json()
    ).validated,
    true,
  );
});
test("public corruption or older promotion leaves the current latest intact", async (t) => {
  const { release, store, fetcher } = await fixture(t);
  await promoteRelease(store, release, fetcher);
  const previous = store.objects.get("towbar/latest.json").body.toString();
  store.objects.get(`towbar/releases/${release.version}/towbar`).body =
    Buffer.from("corrupted");
  await assert.rejects(promoteRelease(store, release, fetcher), /verification/);
  assert.equal(
    store.objects.get("towbar/latest.json").body.toString(),
    previous,
  );
  const older = await fixture(t, "v2.0.29");
  for (const [key, object] of older.store.objects)
    store.objects.set(key, object);
  await assert.rejects(promoteRelease(store, older.release, fetcher), /older/);
  assert.equal(
    store.objects.get("towbar/latest.json").body.toString(),
    previous,
  );
});
test("a concurrent promotion cannot overwrite the changed latest pointer", async (t) => {
  const { release, store, fetcher } = await fixture(t);
  await promoteRelease(store, release, fetcher);
  const put = store.put.bind(store);
  store.put = async (key, body, options) => {
    if (key === "towbar/latest.json")
      store.objects.get(key).etag = "concurrent-promotion";
    return put(key, body, options);
  };
  await assert.rejects(
    promoteRelease(store, release, fetcher),
    /Precondition failed/,
  );
});
test("image validation uses explicit registry identity independently of GitHub owner", () => {
  const release = { version: "v2.0.30", commit: "a".repeat(40) };
  const images = {
    ...release,
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
