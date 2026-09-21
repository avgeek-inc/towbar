import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { format, resolveConfig } from "prettier";
import { appSchema, ipAddressSchema, resourceSchema } from "../src/manifest.js";
import { composeWorkloadSchema } from "../src/platform-expansion.js";
import {
  environmentNameSchema,
  repositoryManifestSchema,
  requiredSecretsSchema,
  resourceRequiredSecretsSchema,
} from "../src/manifest-v2.js";

type Schema = Record<string, unknown>;
const environmentNames = {
  ...z.toJSONSchema(environmentNameSchema, { io: "input" }),
  not: {
    enum: ["preview", "previews", "__proto__", "constructor", "prototype"],
  },
};
function partial(schema: Schema): Schema {
  const result = { ...schema };
  delete result.required;
  if (result.properties)
    result.properties = Object.fromEntries(
      Object.entries(result.properties as Record<string, Schema>).map(
        ([key, value]) => [key, partial(value)],
      ),
    );
  return result;
}
function entitySchema(
  schema:
    typeof appSchema | typeof composeWorkloadSchema | typeof resourceSchema,
  kind: "app" | "compose" | "resource",
) {
  const complete = z.toJSONSchema(schema, { io: "input" }) as Schema;
  const result = partial(complete);
  const properties = result.properties as Record<string, Schema>;
  const overrides = Object.fromEntries(
    Object.entries(properties).filter(
      ([key]) => !["id", "name", "type", "preview"].includes(key),
    ),
  );
  properties.server = z.toJSONSchema(ipAddressSchema, { io: "input" });
  overrides.server = properties.server;
  properties.secrets = z.toJSONSchema(
    kind === "app" ? requiredSecretsSchema : resourceRequiredSecretsSchema,
    { io: "input" },
  );
  properties.environments = {
    type: "object",
    propertyNames: environmentNames,
    additionalProperties: {
      type: "object",
      properties: overrides,
      additionalProperties: false,
    },
  };
  result.required =
    kind === "resource"
      ? ["id", "name", "type", "environments"]
      : ["id", "name", "environments"];
  result.description =
    "Entity defaults are merged with the selected environment before full validation during sync. Branch mappings and secret values are managed in Towbar.";
  return result;
}
const repository = z.toJSONSchema(repositoryManifestSchema, { io: "input" });
const rootEnvironments = repository.properties!.environments as Schema;
rootEnvironments.minProperties = 1;
rootEnvironments.propertyNames = environmentNames;
const schemas = {
  "repository.v2": repository,
  "app.v2": entitySchema(appSchema, "app"),
  "compose.v2": entitySchema(composeWorkloadSchema, "compose"),
  "resource.v2": entitySchema(resourceSchema, "resource"),
};
for (const [name, schema] of Object.entries(schemas)) {
  const file = new URL(`../schemas/${name}.json`, import.meta.url);
  const output = await format(
    JSON.stringify({
      ...schema,
      $id: `https://www.towbar.dev/schemas/${name}.json`,
    }),
    { ...(await resolveConfig(file)), parser: "json" },
  );
  if (process.argv.includes("--check")) {
    if ((await readFile(file, "utf8")) !== output)
      throw new Error(
        `${name} schema is stale; run pnpm --filter @workspace/towbar-core schemas`,
      );
  } else await writeFile(file, output);
}
