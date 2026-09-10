---
title: "Shared secrets"
description: "Configure encrypted deployment secrets in Towbar."
---

Towbar manages deployment secrets without an AWS Secrets Manager account. Values and assignments live in the editor, separate from `towbar.yml` and the entity files under `.towbar/`. Owners manage shared keys and values in Towbar. App and resource key names are declared in YAML; their values are edited in Towbar. Saved values stay hidden until an owner clicks the eye icon or opens File mode.

## Choose the right scope

| Location                          | Purpose                                                                                |
| --------------------------------- | -------------------------------------------------------------------------------------- |
| Manage → Shared secrets           | Reusable workspace values for each environment and stage                               |
| Source → Settings → Secrets       | Reusable values for one Source                                                         |
| App → Settings → Secrets          | Named-environment and isolated preview values for one app                              |
| Resource → Settings → Secrets     | Environment-specific runtime values, including `POSTGRES_PASSWORD` or `REDIS_PASSWORD` |
| Server → Settings → Configuration | SSH private key and Cloudflare API token                                               |

Shared secrets are available for reference; they are not automatically added to Sources, apps, or resources. Configure each variable where it is needed:

```dotenv
API_TOKEN={{globals.API_TOKEN}}
DATABASE_PASSWORD={{source.DATABASE_PASSWORD}}
AUTH_HEADER=Bearer {{globals.API_TOKEN}}
```

`globals` reads a value from **Manage → Shared secrets**. `source` reads a value from the app or resource's own Source. A Source value can reference a global value; apps and resources can reference either scope. Global values are literal, and Source values cannot reference other Source values. References may be embedded in a larger value. Missing or invalid references stop deployment with an error that does not include secret values.

References use the same environment and stage as the child variable. Each named environment is isolated. Preview values use `preview:<environment>`; for example, a staging preview reads `preview:staging` references, never staging or production values. Resources use their own environment runtime values. Empty strings are valid values. Removing a required key from the entity YAML deletes its saved value on the next successful sync of that environment. It does not restore an inherited value. Hooks receive values only when that hook is configured.

### Required keys

Apps declare `secrets.build`, `secrets.runtime`, `secrets.preDeploy`, and
`secrets.postDeploy` at entity level. Resources declare only `secrets.runtime`;
build and hook stages are rejected. Sync adds new keys unset, preserves existing
values and references, and removes values for deleted declarations only in the
synced environment. The editor always shows declared keys. Missing values block
deployment; they do not block sync. Key changes are made in Git, while shared
secret keys remain editable in Towbar.

## Form and File modes

For Shared secrets, select a connected environment or its preview scope in the secondary sidebar, then choose the stage inside the page. On an app or Source, both environment and stage stay inside the page. Use the **Form** and **File** tabs inside the secrets widget. In-page environment and stage selectors use dropdowns on mobile and tabs on larger screens.

**Form** edits one key and value at a time. Configured values show a masked placeholder; use the eye icon to reveal or hide one value. Valid shared-reference expressions are highlighted in yellow.

**File** fetches and reveals the stored values for the selected scope, environment, and stage in a `.env` editor. Edit one `KEY=value` assignment per line. Quoted values, multiline quoted strings, comments, and optional `export` prefixes are supported. Quote values containing `#` to keep it as part of the value. Duplicate keys and invalid syntax must be corrected before saving or switching back to Form. Comments and formatting are not stored.

```dotenv
LOG_LEVEL="info"
PACKAGE_TOKEN="{{source.PACKAGE_REGISTRY_TOKEN}}"
AUTH_HEADER="Bearer {{globals.API_TOKEN}}"
```

Removing a line deletes that key when saved; `KEY=` saves an empty string. Unchanged values are preserved. Switching modes does not save: use **Save** to apply edits. References remain expressions in the editor and resolve only for execution.

<div className="towbar-doc-screenshot">
  <div className="towbar-product-light"><img src="/assets/guides/secrets-file-light.webp" alt="The .env File editor using synthetic example secret values." width="2160" height="1168" loading="lazy" /></div>
  <div className="towbar-product-dark"><img src="/assets/guides/secrets-file-dark.webp" alt="The .env File editor using synthetic example secret values." width="2160" height="1168" loading="lazy" /></div>
</div>

## Save and deploy

The editor shows locally configured keys. Click the eye icon to reveal a stored value, then click it again to hide it. Revealing a value does not change it. References are shown as the stored expression so they remain editable; deployment resolves them to the referenced value. Leaving a replacement input untouched preserves the value. Replacing it with an empty string explicitly saves an empty value. Concurrent edits are rejected; refresh and reapply the intended changes.

**Save** stores changes for the next execution. It does not restart containers or enqueue deployment. Deploy the affected app or resource separately when you are ready. Build changes require rebuilding the image. Runtime changes require a replacement deployment. Image rollback uses current secrets and does not restore revoked credentials.

Shared Preview values and app references can be saved independently and are used by later eligible Preview deployments. Towbar rechecks pull request eligibility and rejects deployment while another deployment or cleanup is active.

<div className="towbar-doc-screenshot">
  <div className="towbar-product-light">
    <img src="/assets/features/secrets-light.webp" alt="Example Shared secrets editor. Configured keys are visible; stored secret values remain hidden." width="2160" height="768" loading="lazy" />
  </div>
  <div className="towbar-product-dark">
    <img src="/assets/features/secrets-dark.webp" alt="Example Shared secrets editor. Configured keys are visible; stored secret values remain hidden." width="2160" height="768" loading="lazy" />
  </div>
  <p>Example Shared secrets editor. Configured keys are visible; stored secret values remain hidden.</p>
</div>

## Rotate credentials

Changing `POSTGRES_PASSWORD` in Towbar does not change the password already stored inside an existing PostgreSQL database. Coordinate database password rotation separately. SSH and Cloudflare replacement similarly updates what Towbar uses; it does not provision those credentials at the provider or server.

Enable Cloudflare DNS TLS under **Server → Settings**, then store its token under
**Server → Settings → Configuration**. Workload YAML continues selecting
`tls.mode: cloudflare-dns` when that deployment requires it.

## External secret managers

Applications may install and invoke their own secret-manager CLI in a Dockerfile or entrypoint. Towbar needs no provider adapter. Supply only the bootstrap credential through the appropriate Towbar stage.

For builds, use Docker BuildKit secret mounts, for example `RUN --mount=type=secret,id=INFISICAL_TOKEN ...`. Never bake the token into `ARG`, `ENV`, or an image layer. Towbar retains the individual BuildKit mounts and the `TOWBAR_BUILD_ENV_JSON` aggregate mount; that aggregate name is reserved.

For runtime, configure the bootstrap credential as a runtime secret and launch the application through the manager's entrypoint command, such as `infisical run -- ...`. Follow the provider's authentication instructions. Credentials fetched inside the application remain the application's responsibility, including avoiding logging them.

References: [Docker build secrets](https://docs.docker.com/build/building/secrets/) and [Infisical Docker integration](https://infisical.com/docs/documentation/getting-started/docker).

## Public API

Read workspace metadata with `GET /v1/core/settings/secrets?environment=production` and update it with `PATCH /v1/core/settings/secrets/{environment}/{stage}`. Source and app metadata use `GET /v1/core/{sources|apps}/{id}/secrets?environment=production`, with `preview` selecting the separate Preview environment. Resources use `/v1/core/resources/{id}/secrets` and support Production runtime values only. Stage identifiers are `build`, `deployment` (runtime), `pre_deploy`, and `post_deploy`.

Mutations accept `{ "expectedRevision": null, "set": { "KEY": "new value" }, "delete": [] }`. Use `null` only for an unconfigured slot, then use its returned revision for later edits. Send only explicitly changed values; metadata and placeholders are never replacement values. A stale revision returns HTTP 409. Metadata includes local keys, available reference names, revisions, and pending changes. Legacy `inheritedKeys` and `inheritedOrigins` fields are empty. Secret mutations never enqueue work.

Server metadata and writes use `GET` and `PATCH /v1/core/servers/{id}/credentials`, with `privateKey` and `apiToken` fields. Metadata and mutation responses contain no values and disable caching. Secret writes and reveals require a workspace owner. Server credentials remain write-only. Slack and SMTP provider credentials are installation environment variables and never pass through these APIs.

After saving, queue a production deployment through the existing app/resource deploy action, or a selected preview with `POST /v1/core/previews/{id}/actions/deploy`. Report any queue failure separately from the successful save.

To reveal one stored environment value, send `POST` to the secret stage path followed by `/reveal`, with `{ "key": "ENV_KEY" }`. For example, `/v1/core/apps/{id}/secrets/production/deployment/reveal`. The response contains `value` and `revision`, uses `Cache-Control: no-store`, and records a value-free audit event. Workspace and Source paths support the same operation. Reveal does not resolve references or save changes.

To reveal all stored values for one environment and stage, send `POST` to the same stage path followed by `/reveal-all`, with `{}`. The response contains `values` (a key/value object) and one `revision`. File mode uses this single request. It has the same owner and workspace restrictions, returns stored reference expressions without resolving them, disables caching, and records a value-free audit event with the key count. It does not fetch other scopes, environments, or stages.

## Storage and recovery

Secret records are encrypted in PostgreSQL using the separately configured 32-byte `TOWBAR_CREDENTIALS_KEY`. Authenticated encryption binds each record to its workspace, owner, environment, stage, and identity. Values are resolved by the API for execution and sent over the authenticated internal worker path. An owner can also retrieve one stored value through the explicit reveal operation. Temporal history, metadata responses, deployment snapshots, and audit events contain no plaintext values.

Back up the Towbar database and preserve its encryption key separately. Restore both to recover secret configuration. A database-only backup cannot recover secrets without the matching key. Do not replace the key on an existing installation without re-encrypting its stored credentials; there is no automatic key rotation or secret history in this release.

Source syncs preserve editor configuration for existing App and Resource IDs. Archival retains values; permanent owner deletion removes its records. Shared values and servers remain attached to the workspace. A new App identity starts unconfigured, while a new server IP must be added under **Servers** before a Source can reference it. SSH and Cloudflare values stay scoped to that workspace server. Slack and SMTP are configured for the Towbar installation through deployment environment variables.
