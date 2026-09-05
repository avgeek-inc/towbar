import { format } from "prettier";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  referenceCategories,
  referenceGroup,
  sectionOrder,
} from "../src/areas/external-api/reference-groups.js";
// Exporting route schemas performs no database or network operations.
process.env.DATABASE_TOWBAR_URL ??=
  "postgres://docs:docs@localhost/towbar_docs";
process.env.TOWBAR_CREDENTIALS_KEY ??= Buffer.alloc(32, 1).toString("base64");
process.env.TOWBAR_INTERNAL_HMAC_SECRET ??=
  "documentation-only-placeholder-secret";
const { createOpenApiDocument, operations } =
  await import("../src/areas/external-api/catalogue.js");
const root = resolve(import.meta.dirname, "../../..");
const doc = createOpenApiDocument("https://api.example.com/v1/api");
const output = await format(JSON.stringify(doc), { parser: "json" });
const target = resolve(root, "docs/api-reference/openapi.json");
if (process.argv.includes("--check")) {
  if ((await readFile(target, "utf8")) !== output)
    throw new Error("OpenAPI snapshot is stale. Run pnpm docs:api.");
} else await writeFile(target, output);
const groups = new Map<string, Map<string, string[]>>();
const generatedPages = new Set<string>();
for (const op of operations) {
  const route = `api-reference/${op.name}`;
  generatedPages.add(`${op.name}.mdx`);
  const path = op.path.replace(/:([A-Za-z]+)/g, "{$1}");
  const description = `${op.summary} through the Towbar API and MCP.`;
  const body = await format(
    `---\ntitle: ${JSON.stringify(op.summary)}\ndescription: ${JSON.stringify(description)}\nplayground: simple\nopenapi: ${JSON.stringify(`/api-reference/openapi.json ${op.method} ${path}`)}\n---\n\nMCP tool: \`${op.name}\`. ${op.ownerOnly ? "Requires the workspace owner role." : "Uses your current workspace permissions."}\n\n${op.idempotencyKey ? "Supply an Idempotency-Key for this action. An accepted request may continue asynchronously; poll the returned ID.\n\n" : ""}See [request conventions](/docs/api/overview) and [automation workflows](/docs/api/workflows).\n`,
    { parser: "mdx" },
  );
  const target = resolve(root, `docs/${route}.mdx`);
  if (process.argv.includes("--check")) {
    if ((await readFile(target, "utf8")) !== body)
      throw new Error(`Stale API page: ${route}`);
  } else {
    await mkdir(resolve(root, "docs/api-reference"), { recursive: true });
    await writeFile(target, body);
  }
  const [category, group] = referenceGroup(op.path);
  if (!groups.has(category)) groups.set(category, new Map());
  const subgroups = groups.get(category)!;
  if (!subgroups.has(group)) subgroups.set(group, []);
  subgroups.get(group)!.push(route);
}
// Remove only endpoint pages owned by this exporter when an operation becomes browser-only.
for (const file of await readdir(resolve(root, "docs/api-reference"))) {
  if (!file.endsWith(".mdx") || generatedPages.has(file)) continue;
  const path = resolve(root, "docs/api-reference", file);
  if (!(await readFile(path, "utf8")).includes("\nMCP tool: `")) continue;
  if (process.argv.includes("--check"))
    throw new Error(`Obsolete API page: ${file}. Run pnpm docs:api.`);
  await unlink(path);
}
const configPath = resolve(root, "docs/docs.json");
const config = JSON.parse(await readFile(configPath, "utf8"));
const navigation = {
  tab: "API & MCP",
  // Each MDX page references its spec; a tab-level spec also generates duplicate groups.
  groups: [
    {
      group: "Get started",
      pages: [
        "docs/api/overview",
        "docs/api/authentication",
        "docs/api/mcp",
        "docs/api/workflows",
      ],
    },
    ...referenceCategories.map((category) => ({
      group: category,
      pages: Array.from(groups.get(category) ?? [], ([group, pages]) => ({
        group,
        pages,
      })).sort(
        (a, b) => sectionOrder.indexOf(a.group) - sectionOrder.indexOf(b.group),
      ),
    })),
  ],
};
const current = config.navigation.tabs.findIndex(
  (tab: { tab: string }) => tab.tab === "API & MCP",
);
if (process.argv.includes("--check")) {
  if (
    JSON.stringify(config.navigation.tabs[current]) !==
    JSON.stringify(navigation)
  )
    throw new Error("API navigation is stale. Run pnpm docs:api.");
} else {
  if (current >= 0) config.navigation.tabs[current] = navigation;
  else config.navigation.tabs.push(navigation);
  await writeFile(
    configPath,
    await format(JSON.stringify(config), { parser: "json" }),
  );
}
console.log(`OpenAPI: ${operations.length} operations`);
