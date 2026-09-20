import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { betterAuth } from "better-auth";
import { getAuthTables } from "better-auth/db";
import { organization, twoFactor } from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import { apiKey } from "@better-auth/api-key";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { drizzle } from "drizzle-orm/postgres-js";
import {
  pgSchema,
  text,
  timestamp,
  boolean,
  integer,
} from "drizzle-orm/pg-core";
import postgres from "postgres";

const url = process.env.TOWBAR_AUTH_PROOF_DATABASE_URL;
assert.ok(
  url,
  "Set TOWBAR_AUTH_PROOF_DATABASE_URL to a disposable PostgreSQL database",
);
const client = postgres(url, { max: 4, onnotice: () => undefined });
const schemaName = `auth_proof_${randomUUID().replaceAll("-", "")}`;
const namespace = pgSchema(schemaName);
const ac = createAccessControl({
  organization: ["update"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  inventory: ["read"],
});
const roles = {
  admin: ac.newRole({
    organization: ["update"],
    member: ["create", "update", "delete"],
    invitation: ["create", "cancel"],
    inventory: ["read"],
  }),
  member: ac.newRole({ inventory: ["read"] }),
  viewer: ac.newRole({ inventory: ["read"] }),
};
const options = {
  secret: "isolated-library-proof-secret-at-least-thirty-two-characters",
  baseURL: "http://localhost:4020",
  basePath: "/v1/public/auth/identity",
  trustedOrigins: ["http://localhost:4021"],
  emailAndPassword: { enabled: true, minPasswordLength: 15 },
  session: { cookieCache: { enabled: false } },
  advanced: { database: { generateId: () => randomUUID() } },
  plugins: [
    organization({
      creatorRole: "admin",
      allowUserToCreateOrganization: false,
      ac,
      roles,
    }),
    twoFactor({ issuer: "Towbar" }),
    apiKey([
      {
        configId: "personal",
        references: "user",
        enableSessionForAPIKeys: false,
      },
      {
        configId: "team",
        references: "organization",
        enableSessionForAPIKeys: false,
      },
    ]),
  ],
};
const libraryTables = getAuthTables(options);
const tables = {};
try {
  await client.unsafe(`CREATE SCHEMA "${schemaName}"`);
  for (const [name, table] of Object.entries(libraryTables)) {
    const fields = { id: text("id").primaryKey() };
    const definitions = ['"id" text PRIMARY KEY'];
    for (const [key, field] of Object.entries(table.fields)) {
      const column = field.fieldName ?? key;
      const type =
        field.type === "date"
          ? "timestamptz"
          : field.type === "boolean"
            ? "boolean"
            : field.type === "number"
              ? "integer"
              : "text";
      let builder =
        field.type === "date"
          ? timestamp(column, { withTimezone: true })
          : field.type === "boolean"
            ? boolean(column)
            : field.type === "number"
              ? integer(column)
              : text(column);
      if (field.required) builder = builder.notNull();
      if (field.unique) builder = builder.unique();
      fields[key] = builder;
      definitions.push(
        `"${column}" ${type}${field.required ? " NOT NULL" : ""}${field.unique ? " UNIQUE" : ""}`,
      );
    }
    tables[name] = namespace.table(name, fields);
    await client.unsafe(
      `CREATE TABLE "${schemaName}"."${name}" (${definitions.join(", ")})`,
    );
  }
  const database = drizzle(client, { schema: tables });
  const auth = betterAuth({
    ...options,
    database: drizzleAdapter(database, {
      provider: "pg",
      schema: tables,
      transaction: true,
    }),
  });
  const password = "correct horse battery staple for auth proof";
  const start = performance.now();
  const signedUp = await auth.api.signUpEmail({
    body: { email: "admin@example.test", name: "Test admin", password },
  });
  assert.ok(signedUp.user.id);
  const elapsed = Math.round(performance.now() - start);
  const workspace = await auth.api.createOrganization({
    body: { name: "Proof team", slug: "proof", userId: signedUp.user.id },
  });
  assert.equal(workspace.members[0].role, "admin");
  const response = await auth.api.signInEmail({
    body: { email: "admin@example.test", password },
    asResponse: true,
  });
  assert.equal(response.status, 200);
  const cookies = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const headers = new Headers({
    cookie: cookies,
    origin: "http://localhost:4021",
  });
  assert.ok((await auth.api.getSession({ headers })).session.id);
  await assert.rejects(
    auth.api.createOrganization({
      headers,
      body: { name: "Unauthorized second team", slug: "second" },
    }),
  );
  const personal = await auth.api.createApiKey({
    body: {
      configId: "personal",
      name: "Proof personal",
      userId: signedUp.user.id,
      expiresIn: 86400,
    },
  });
  const team = await auth.api.createApiKey({
    body: {
      configId: "team",
      name: "Proof team",
      userId: signedUp.user.id,
      organizationId: workspace.id,
      expiresIn: 86400,
    },
  });
  assert.equal(
    (
      await auth.api.verifyApiKey({
        body: { key: personal.key, configId: "personal" },
      })
    ).valid,
    true,
  );
  assert.equal(
    (await auth.api.verifyApiKey({ body: { key: team.key, configId: "team" } }))
      .valid,
    true,
  );
  assert.equal(
    await auth.api.getSession({
      headers: new Headers({ "x-api-key": personal.key }),
    }),
    null,
  );
  await auth.api.signOut({ headers });
  assert.equal(await auth.api.getSession({ headers }), null);
  await database
    .transaction(async (tx) => {
      const scoped = betterAuth({
        ...options,
        database: drizzleAdapter(tx, {
          provider: "pg",
          schema: tables,
          transaction: true,
        }),
      });
      await scoped.api.signUpEmail({
        body: { email: "rollback@example.test", name: "Rollback", password },
      });
      throw new Error("rollback-proof");
    })
    .then(
      () => assert.fail("Expected rollback"),
      (error) => assert.equal(error.message, "rollback-proof"),
    );
  assert.equal(
    (
      await client.unsafe(
        `SELECT count(*)::int AS count FROM "${schemaName}"."user" WHERE email='rollback@example.test'`,
      )
    )[0].count,
    0,
  );
  console.log(
    JSON.stringify({
      version: "1.7.5",
      passwordAndSignupMs: elapsed,
      checks: [
        "schema",
        "sign-in cookies",
        "live session/revocation",
        "admin creator",
        "blocked organization creation",
        "personal and team keys",
        "no API-key session emulation",
        "transaction-bound adapter rollback",
      ],
    }),
  );
} finally {
  await client.unsafe(`DROP SCHEMA "${schemaName}" CASCADE`);
  await client.end();
}
