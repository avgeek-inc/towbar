import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  decryptCredential,
  encryptCredential,
  normalizeDeploymentManifest,
} from "@workspace/towbar-core";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.TOWBAR_TEST_DATABASE_URL;
const folder = fileURLToPath(new URL("../drizzle", import.meta.url));

async function migrateDatabase(databaseUrl, migrationsFolder) {
  const connection = postgres(databaseUrl, { max: 1, onnotice() {} });
  try {
    await migrate(drizzle(connection), { migrationsFolder });
  } finally {
    await connection.end();
  }
}

test(
  "image-to-service upgrade preserves identity, encrypted secrets and deployment history",
  { skip: !url },
  async () => {
    assert(new URL(url).pathname.endsWith("_test"));
    const admin = postgres(url, { max: 1, onnotice() {} });
    const name = `image_upgrade_${randomUUID().replaceAll("-", "")}_test`;
    const previous = await mkdtemp(join(tmpdir(), "towbar-image-upgrade-"));
    let client;
    try {
      await cp(folder, previous, { recursive: true });
      const journal = JSON.parse(
        await readFile(join(previous, "meta/_journal.json"), "utf8"),
      );
      const index = journal.entries.findIndex(
        (entry) => entry.tag === "0010_services_datastores",
      );
      assert(index > 0);
      journal.entries = journal.entries.slice(0, index);
      await writeFile(
        join(previous, "meta/_journal.json"),
        JSON.stringify(journal),
      );
      await admin.unsafe(`CREATE DATABASE "${name}"`);
      const isolated = new URL(url);
      isolated.pathname = `/${name}`;
      client = postgres(isolated.href, { max: 1, onnotice() {} });
      await migrateDatabase(isolated.href, previous);

      const [workspace] =
        await client`insert into towbar_workspaces (name,slug) values ('Image upgrade','image-upgrade') returning id`;
      const [installation] =
        await client`insert into towbar_integration_installations (workspace_id,provider,external_id,principal_name,principal_type) values (${workspace.id},'github','123','example','Organization') returning id`;
      const [source] =
        await client`insert into towbar_sources (workspace_id,integration_installation_id,repository_owner,repository_name) values (${workspace.id},${installation.id},'example','platform-services') returning id`;
      const [environment] =
        await client`insert into towbar_source_environments (source_id,name,branch) values (${source.id},'production','main') returning *`;
      const [server] =
        await client`insert into towbar_servers (workspace_id,canonical_ip,config,config_digest) values (${workspace.id},'192.0.2.10','{}','fixture') returning id`;
      const [entity] =
        await client`insert into towbar_source_entities (source_id,entity_type,manifest_id,resource_type) values (${source.id},'resource','infisical','image') returning id`;
      const config = {
        id: "infisical",
        kind: "image",
        name: "Infisical",
        image: "infisical/infisical:v0.165.15",
        server: "192.0.2.10",
        sourceBranch: "main",
        autoDeploy: false,
        container: {
          port: 8080,
          network: "platform-services",
          networkAlias: "infisical",
          command: [],
          volumes: [],
        },
        health: { type: "http", path: "/api/status", timeoutSeconds: 180 },
      };
      const declarations = {
        build: [],
        runtime: ["AUTH_SECRET", "ENCRYPTION_KEY"],
        preDeploy: [],
        postDeploy: [],
      };
      const [app] =
        await client`insert into towbar_apps (workspace_id,source_id,server_id,entity_id,source_environment_id,required_secrets,manifest_id,kind,name,config,config_digest,source_revision) values (${workspace.id},${source.id},${server.id},${entity.id},${environment.id},${client.json(declarations)},'infisical','image','Infisical',${client.json(config)},'original-digest','original-commit') returning id`;
      const secretId = randomUUID();
      const masterKey = randomBytes(32);
      const associatedData = `${workspace.id}:app:${app.id}:production:deployment:${secretId}`;
      const values = {
        AUTH_SECRET: "original-auth",
        ENCRYPTION_KEY: "original-encryption",
      };
      const envelope = encryptCredential({
        associatedData,
        masterKey,
        value: values,
      });
      await client`insert into towbar_managed_secrets (id,workspace_id,source_id,app_id,owner,environment,stage,encrypted_payload,keys,revision) values (${secretId},${workspace.id},${source.id},${app.id},${`app:${app.id}`},'production','deployment',${client.json(envelope)},${client.json(Object.keys(values))},${randomUUID()})`;
      const [deployment] =
        await client`insert into towbar_deployments (workspace_id,source_id,app_id,server_id,target_environment,idempotency_key,temporal_workflow_id,deployable_kind,state,commit_sha,manifest_digest,required_secrets,app_snapshot,server_snapshot) values (${workspace.id},${source.id},${app.id},${server.id},${client.json({ id: environment.id, name: environment.name, branch: environment.branch, mappingRevision: environment.mapping_revision })},'original-deployment','original-workflow','image','succeeded','original-commit','original-manifest',${client.json(declarations)},${client.json(config)},'{}') returning id`;
      await client`insert into towbar_releases (app_id,deployment_id,status,commit_sha,image_tag,container_name) values (${app.id},${deployment.id},'current','original-commit','original-image','original-container')`;
      await client`insert into towbar_deployment_steps (deployment_id,sequence,state,status) values (${deployment.id},0,'succeeded','succeeded')`;
      await client`insert into towbar_deployment_log_chunks (deployment_id,sequence,stream,content) values (${deployment.id},0,'stdout','Original deployment log')`;
      await client`insert into towbar_image_vulnerability_scans (workspace_id,source_id,app_id,server_id,deployment_id,image_digest,state,severity_totals) values (${workspace.id},${source.id},${app.id},${server.id},${deployment.id},${`sha256:${"a".repeat(64)}`},'clean','{}')`;
      const before =
        await client`select * from towbar_managed_secrets where id=${secretId}`;

      // Unsupported commands must stop the transaction without removing records.
      await client`update towbar_apps set config=jsonb_set(config,'{container,command}','["custom-command"]') where id=${app.id}`;
      await assert.rejects(
        migrateDatabase(isolated.href, folder),
        /custom runtime settings converted to a service/u,
      );
      assert.equal(
        (await client`select kind from towbar_apps where id=${app.id}`)[0].kind,
        "image",
      );
      assert.deepEqual(
        await client`select * from towbar_managed_secrets where id=${secretId}`,
        before,
      );
      await client`update towbar_apps set config=${client.json(config)} where id=${app.id}`;

      await migrateDatabase(isolated.href, folder);
      await migrateDatabase(isolated.href, folder);
      const [converted] =
        await client`select * from towbar_apps where id=${app.id}`;
      assert.equal(converted.kind, "app");
      assert.equal(converted.entity_id, entity.id);
      assert.deepEqual(
        (
          await client`select entity_type,resource_type from towbar_source_entities where id=${entity.id}`
        )[0],
        { entity_type: "app", resource_type: null },
      );
      const after =
        await client`select * from towbar_managed_secrets where id=${secretId}`;
      assert.deepEqual(after, before);
      assert.deepEqual(
        decryptCredential({
          associatedData,
          masterKey,
          envelope: after[0].encrypted_payload,
        }),
        values,
      );
      const expected = normalizeDeploymentManifest({
        version: 2,
        source: { branch: "main" },
        apps: [
          {
            id: config.id,
            name: config.name,
            server: config.server,
            autoDeploy: config.autoDeploy,
            deployment: { type: "image", image: config.image },
            container: {
              port: 8080,
              network: "platform-services",
              networkAlias: "infisical",
            },
            health: { path: "/api/status", timeoutSeconds: 180 },
            rollout: {
              type: "recreate",
              maintenanceMode: true,
              terminationSeconds: 30,
              reason: "Keep the existing single-container deployment",
            },
          },
        ],
      }).apps[0];
      assert.deepEqual(converted.config, expected);
      const [history] =
        await client`select deployable_kind,app_snapshot,state from towbar_deployments where id=${deployment.id}`;
      assert.equal(history.deployable_kind, "app");
      assert.equal(history.state, "succeeded");
      assert.deepEqual(history.app_snapshot, expected);
      for (const table of [
        "towbar_releases",
        "towbar_deployment_steps",
        "towbar_deployment_log_chunks",
        "towbar_image_vulnerability_scans",
      ])
        assert.equal(
          (
            await client.unsafe(
              `select count(*)::int as count from ${table} where deployment_id=$1`,
              [deployment.id],
            )
          )[0].count,
          1,
          table,
        );
    } finally {
      await client?.end();
      await admin.unsafe(`DROP DATABASE IF EXISTS "${name}"`);
      await admin.end();
      await rm(previous, { recursive: true, force: true });
    }
  },
);
