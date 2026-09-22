import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  documentationTopics,
  widgetDocumentation,
} from "../apps/towbar-web-app/src/lib/documentation.ts";

const root = fileURLToPath(new URL("../docs/", import.meta.url));
const repository = path.dirname(root);
const config = JSON.parse(await readFile(path.join(root, "docs.json"), "utf8"));
const pages = new Map();
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== "plans") await collect(file);
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
    /(?:(?:href|src)="([^"\n]+)"|\]\((\/[^\s)]+)\))/g,
  )) {
    await checkLink(match[1] ?? match[2], route);
  }
}
for (const [name, help] of Object.entries({
  ...documentationTopics,
  ...widgetDocumentation,
})) {
  const url = new URL(help.href);
  if (url.origin !== "https://www.towbar.dev")
    failures.push(`Unrecognized help destination: ${name}`);
  await checkLink(`${url.pathname}${url.hash}`, `App help: ${name}`);
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

function jpegDimensions(image) {
  if (image[0] !== 0xff || image[1] !== 0xd8)
    throw new Error("not a JPEG image");
  const frameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
    0xcf,
  ]);
  let offset = 2;
  while (offset + 8 < image.length) {
    if (image[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = image[offset + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    const length = image.readUInt16BE(offset + 2);
    if (frameMarkers.has(marker))
      return {
        height: image.readUInt16BE(offset + 5),
        width: image.readUInt16BE(offset + 7),
      };
    if (length < 2) break;
    offset += length + 2;
  }
  throw new Error("missing JPEG frame dimensions");
}

async function checkReleaseScreenshots() {
  const manifest = JSON.parse(
    await readFile(
      path.join(repository, "tools/release-screenshots.json"),
      "utf8",
    ),
  );
  const names = new Set();
  const requiredDimensions = { width: 2560, height: 1440 };
  for (const screenshot of manifest.screenshots) {
    if (names.has(screenshot.name))
      failures.push(`Duplicate release screenshot: ${screenshot.name}`);
    names.add(screenshot.name);
    if (!/^\/(?!\/)/.test(screenshot.route) || /[()]/.test(screenshot.route))
      failures.push(
        `${screenshot.name}: screenshot route must be a canonical app path`,
      );
    if (
      screenshot.themes.length !== 2 ||
      new Set(screenshot.themes.map((item) => item.theme)).size !== 2 ||
      !screenshot.themes.some((item) => item.theme === "light") ||
      !screenshot.themes.some((item) => item.theme === "dark")
    )
      failures.push(`${screenshot.name}: light and dark captures are required`);
    for (const theme of screenshot.themes) {
      const file = path.join(repository, theme.file);
      try {
        const actual = jpegDimensions(await readFile(file));
        if (actual.width !== theme.width || actual.height !== theme.height)
          failures.push(
            `${theme.file}: manifest says ${theme.width}x${theme.height}, image is ${actual.width}x${actual.height}`,
          );
        if (
          actual.width !== requiredDimensions.width ||
          actual.height !== requiredDimensions.height
        )
          failures.push(
            `${theme.file}: release screenshots must be 2x viewport captures (${requiredDimensions.width}x${requiredDimensions.height})`,
          );
      } catch (error) {
        failures.push(`${theme.file}: ${error.message}`);
      }
      for (const guide of screenshot.guides) {
        try {
          const source = await readFile(path.join(repository, guide), "utf8");
          if (!source.includes(path.basename(theme.file)))
            failures.push(`${guide}: missing ${path.basename(theme.file)}`);
        } catch {
          failures.push(`${screenshot.name}: missing guide ${guide}`);
        }
      }
    }
  }
}
await checkReleaseScreenshots();
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `Checked ${pages.size} pages and release screenshots: metadata, navigation, redirects, internal links, themes, and dimensions.`,
  );
