const versionPattern = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const schemas = new Set([
  "repository.v2.json",
  "app.v2.json",
  "compose.v2.json",
  "resource.v2.json",
]);
const files = new Set(["install.sh", "source.tar.gz", "SHA256SUMS"]);
const types = {
  "install.sh": "text/x-shellscript; charset=utf-8",
  towbar: "text/x-shellscript; charset=utf-8",
  "source.tar.gz": "application/gzip",
  SHA256SUMS: "text/plain; charset=utf-8",
};
const missing = () =>
  new Response("No validated release is available.\n", {
    status: 404,
    headers: { "cache-control": "no-store" },
  });

export default {
  async fetch(request, env) {
    if (request.method !== "GET" && request.method !== "HEAD")
      return new Response(null, {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });
    const url = new URL(request.url);
    if (url.origin !== env.DISTRIBUTION_ORIGIN) return missing();
    const product = /^\/([a-z0-9-]+)\/(.*)$/.exec(url.pathname);
    if (!product || !env.PRODUCTS.split(",").includes(product[1]))
      return missing();
    const prefix = `${product[1]}/`;
    const path = "/" + product[2];
    let key;
    let mutable = false;
    if (
      path === "/releases/latest.json" ||
      path === "/install.sh" ||
      path.startsWith("/schemas/")
    ) {
      const latest = await env.RELEASES.get(`${prefix}latest.json`);
      if (!latest) return missing();
      const release = await latest.json();
      if (!versionPattern.test(release.version) || release.validated !== true)
        return missing();
      mutable = true;
      if (path === "/releases/latest.json")
        return new Response(
          request.method === "HEAD" ? null : JSON.stringify(release),
          {
            headers: {
              "content-type": "application/json",
              "cache-control": "no-store",
            },
          },
        );
      if (path === "/install.sh")
        key = `${prefix}releases/${release.version}/install.sh`;
      else {
        const name = path.slice("/schemas/".length);
        if (!schemas.has(name)) return missing();
        key = `${prefix}releases/${release.version}/schemas/${name}`;
      }
    } else {
      const match = /^\/releases\/(v\d+\.\d+\.\d+)\/(.+)$/.exec(path);
      if (!match || !versionPattern.test(match[1])) return missing();
      const [, version, name] = match;
      if (name === "release.json") {
        const manifest = await env.RELEASES.get(
          `${prefix}releases/${version}/release.json`,
        );
        if (!manifest) return missing();
        const release = await manifest.json();
        const validated = await env.RELEASES.get(
          `${prefix}releases/${version}/validated.json`,
        );
        // Candidate artifacts are accessible for the release installation smoke.
        const result = validated
          ? await validated.json()
          : { ...release, validated: false };
        return new Response(
          request.method === "HEAD" ? null : JSON.stringify(result),
          {
            headers: {
              "content-type": "application/json",
              "cache-control": "no-store",
            },
          },
        );
      }
      if (
        !files.has(name) &&
        name !== product[1] &&
        name !== `${product[1]}-images.json` &&
        !(name.startsWith("schemas/") && schemas.has(name.slice(8)))
      )
        return missing();
      key = `${prefix}releases/${version}/${name}`;
    }
    const object = await env.RELEASES.get(key);
    if (!object) return missing();
    const name = key.split("/").at(-1);
    return new Response(request.method === "HEAD" ? null : object.body, {
      headers: {
        "content-type": types[name] ?? "application/json",
        "cache-control": mutable
          ? "no-store"
          : "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
        etag: object.httpEtag,
      },
    });
  },
};
