import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export const identity = JSON.parse(
  await readFile(new URL("../../repository.json", import.meta.url), "utf8"),
);
export const artifactNames = [
  "install.sh",
  "towbar",
  "source.tar.gz",
  "towbar-images.json",
  ...["repository", "app", "compose", "resource"].map(
    (name) => `schemas/${name}.v2.json`,
  ),
];
export const sha256 = (data) => createHash("sha256").update(data).digest("hex");
export function validateRelease(release) {
  if (
    release.schemaVersion !== 1 ||
    !/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(release.version) ||
    !release.version
      .slice(1)
      .split(".")
      .map(Number)
      .every(Number.isSafeInteger) ||
    !/^[a-f0-9]{40}$/.test(release.commit) ||
    !Number.isFinite(Date.parse(release.createdAt))
  )
    throw new Error("Invalid release identity");
  if (
    JSON.stringify(Object.keys(release.artifacts ?? {}).sort()) !==
      JSON.stringify([...artifactNames, "SHA256SUMS"].sort()) ||
    Object.values(release.artifacts).some(
      (hash) => !/^[a-f0-9]{64}$/.test(hash),
    )
  )
    throw new Error("Invalid release checksums");
  return release;
}
export function validateImages(images, release) {
  if (
    images.version !== release.version ||
    images.commit !== release.commit ||
    JSON.stringify(Object.keys(images.images ?? {}).sort()) !==
      JSON.stringify(["api", "web-app", "worker"])
  )
    throw new Error("Image manifest does not match the release");
  for (const [service, image] of Object.entries(images.images)) {
    const prefix = `${identity.imageRegistry}/towbar-${service}@sha256:`;
    if (
      !image.startsWith(prefix) ||
      !/^[a-f0-9]{64}$/.test(image.slice(prefix.length))
    )
      throw new Error(`Invalid immutable ${service} image`);
  }
}
export async function putImmutable(store, key, body, contentType) {
  try {
    await store.put(key, body, { ifNoneMatch: "*", contentType });
  } catch (error) {
    if (error.$metadata?.httpStatusCode !== 412) throw error;
    const existing = await store.get(key);
    if (!existing || sha256(existing.body) !== sha256(body))
      throw new Error(
        `Immutable artifact already exists with different content: ${key}`,
      );
  }
}
export async function uploadRelease(store, directory) {
  const release = validateRelease(
    JSON.parse(await readFile(`${directory}/release.json`, "utf8")),
  );
  const payloads = new Map();
  for (const name of [...artifactNames, "SHA256SUMS"]) {
    const body = await readFile(`${directory}/${name}`);
    if (sha256(body) !== release.artifacts[name])
      throw new Error(`Checksum mismatch: ${name}`);
    payloads.set(name, body);
  }
  validateImages(JSON.parse(payloads.get("towbar-images.json")), release);
  const prefix = `${identity.releasePrefix}/releases/${release.version}/`;
  for (const [name, body] of payloads)
    await putImmutable(
      store,
      prefix + name,
      body,
      name.endsWith(".json") ? "application/json" : "application/octet-stream",
    );
  await putImmutable(
    store,
    prefix + "release.json",
    await readFile(`${directory}/release.json`),
    "application/json",
  );
  return release;
}
export async function verifyPublicRelease(release, fetcher = fetch) {
  validateRelease(release);
  const base = `${identity.distributionUrl}/releases/${release.version}/`;
  const manifest = await fetcher(base + "release.json", {
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!manifest.ok)
    throw new Error("The domain did not serve the release manifest");
  const publicRelease = await manifest.json();
  if (
    publicRelease.version !== release.version ||
    publicRelease.commit !== release.commit ||
    JSON.stringify(publicRelease.artifacts) !==
      JSON.stringify(release.artifacts)
  )
    throw new Error("The public release identity differs from the upload");
  for (const [name, hash] of Object.entries(release.artifacts)) {
    const response = await fetcher(base + name, {
      signal: AbortSignal.timeout(120_000),
    });
    if (
      !response.ok ||
      sha256(Buffer.from(await response.arrayBuffer())) !== hash
    )
      throw new Error(`Public artifact failed verification: ${name}`);
  }
}
export async function promoteRelease(store, release, fetcher = fetch) {
  await verifyPublicRelease(release, fetcher);
  const key = `${identity.releasePrefix}/latest.json`;
  const previous = await store.get(key);
  if (previous) {
    const latest = validateRelease(JSON.parse(previous.body.toString()));
    const compare = release.version.slice(1).split(".").map(Number);
    const current = latest.version.slice(1).split(".").map(Number);
    let order = 0;
    for (let i = 0; i < 3 && !order; i++)
      order = Math.sign(compare[i] - current[i]);
    if (order < 0 || (order === 0 && release.commit !== latest.commit))
      throw new Error(
        "Refusing to replace latest with an older or different release",
      );
  }
  const validated = Buffer.from(
    JSON.stringify({ ...release, validated: true }) + "\n",
  );
  await putImmutable(
    store,
    `${identity.releasePrefix}/releases/${release.version}/validated.json`,
    validated,
    "application/json",
  );
  // Compare-and-swap prevents parallel releases overwriting a newer promotion.
  await store.put(key, validated, {
    ...(previous ? { ifMatch: previous.etag } : { ifNoneMatch: "*" }),
    contentType: "application/json",
    cacheControl: "no-store",
  });
  await verifyStableRelease(release, fetcher);
}

export async function verifyStableRelease(release, fetcher = fetch) {
  validateRelease(release);
  const response = await fetcher(
    `${identity.distributionUrl}/releases/latest.json`,
    {
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok)
    throw new Error("The stable release pointer is unavailable");
  const latest = validateRelease(await response.json());
  if (
    latest.validated !== true ||
    latest.version !== release.version ||
    latest.commit !== release.commit ||
    JSON.stringify(latest.artifacts) !== JSON.stringify(release.artifacts)
  )
    throw new Error(
      "The stable release pointer differs from the promoted release",
    );
  for (const name of [
    "install.sh",
    ...artifactNames.filter((name) => name.startsWith("schemas/")),
  ]) {
    const artifact = await fetcher(`${identity.distributionUrl}/${name}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    if (
      !artifact.ok ||
      sha256(Buffer.from(await artifact.arrayBuffer())) !==
        release.artifacts[name]
    )
      throw new Error(`Stable artifact failed verification: ${name}`);
  }
}
