import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../docs/", import.meta.url));
const config = JSON.parse(await readFile(path.join(root, "docs.json"), "utf8"));
const pages = new Map();
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await collect(file);
    else if (/\.mdx?$/.test(entry.name)) {
      const route = `/${path.relative(root, file).replace(/\.mdx?$/, "")}`;
      const source = await readFile(file, "utf8");
      assert.match(
        source,
        /^---\n[\s\S]*?title: .+\n[\s\S]*?description: .+\n[\s\S]*?---/,
        `${route}: missing page metadata`,
      );
      pages.set(route, source);
    }
  }
}
await collect(root);
const redirects = new Map(
  config.redirects.map(({ source, destination }) => [source, destination]),
);
const failures = [];
const navigated = new Set();
function navigation(node) {
  if (typeof node === "string") {
    const route = `/${node}`;
    if (!pages.has(route)) failures.push(`Navigation page missing: ${route}`);
    if (navigated.has(route))
      failures.push(`Duplicate navigation page: ${route}`);
    navigated.add(route);
  } else if (Array.isArray(node)) node.forEach(navigation);
  else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (["tabs", "groups", "pages"].includes(key)) navigation(value);
    }
  }
}
navigation(config.navigation);
for (const route of pages.keys()) {
  if (route.startsWith("/docs/") && !navigated.has(route))
    failures.push(`Guide is absent from navigation: ${route}`);
}
const slug = (text) =>
  text
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
async function checkLink(href, from) {
  if (!href.startsWith("/") || href.startsWith("//")) return;
  const [target, hash] = href.split("#");
  let route = target.split("?")[0];
  const seen = new Set();
  while (redirects.has(route)) {
    if (seen.has(route)) {
      failures.push(`Redirect cycle: ${route}`);
      return;
    }
    seen.add(route);
    route = redirects.get(route);
  }
  if (route === "/") route = "/index";
  if (!pages.has(route) && pages.has(`${route}/index`)) route += "/index";
  const source = pages.get(route);
  if (source !== undefined) {
    if (hash) {
      const anchors = new Set(
        [...source.matchAll(/^#{1,6} (.+)$/gm)].map((match) => slug(match[1])),
      );
      for (const match of source.matchAll(/\bid="([^"]+)"/g))
        anchors.add(match[1]);
      if (!anchors.has(decodeURIComponent(hash)))
        failures.push(`${from}: missing anchor ${href}`);
    }
    return;
  }
  try {
    const asset = await stat(path.join(root, route));
    if (!asset.isFile()) throw new Error("not a file");
  } catch {
    failures.push(`${from}: missing target ${href}`);
  }
}
for (const [route, source] of pages) {
  const prose = source.replace(/```[\s\S]*?```/g, "");
  for (const match of prose.matchAll(
    /(?:href="([^"\n]+)"|\]\((\/[^\s)]+)\))/g,
  )) {
    await checkLink(match[1] ?? match[2], route);
  }
}
async function configLinks(node) {
  if (Array.isArray(node)) for (const value of node) await configLinks(value);
  else if (node && typeof node === "object")
    for (const [key, value] of Object.entries(node)) {
      if (["href", "destination"].includes(key) && typeof value === "string")
        await checkLink(value, "docs.json");
      else if (typeof value === "object") await configLinks(value);
    }
}
await configLinks(config);
for (const route of redirects.keys())
  if (pages.has(route)) failures.push(`Redirect shadows page: ${route}`);
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `Checked ${pages.size} pages: metadata, navigation, redirects, and internal links.`,
  );
