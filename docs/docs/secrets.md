---
title: "Shared secrets"
description: "Configure encrypted deployment secrets in Towbar."
---

Towbar manages deployment secrets without an AWS Secrets Manager account. Values and assignments live in the editor, separate from `.towbar/deployment.yml`. Owners can create, replace, and delete values. Saved values cannot be revealed or exported through the public API.

## Choose the right scope

| Location                          | Purpose                                                                      |
| --------------------------------- | ---------------------------------------------------------------------------- |
| Manage → Shared secrets           | Workspace production and preview defaults for every deployment stage         |
| Source → Settings → Secrets       | Production and preview defaults for one Source                               |
| App → Settings → Secrets          | Production and preview values for one app                                    |
| Resource → Settings → Secrets     | Production runtime values, including `POSTGRES_PASSWORD` or `REDIS_PASSWORD` |
| Server → Settings → Configuration | SSH private key and Cloudflare API token                                     |

Secrets resolve from Shared secrets to the Source and then the app or resource. A value at a more specific level overrides the same key inherited from the level above; deleting the override restores inheritance. Production and Preview are separate at every level, so Preview apps inherit workspace and Source Preview values without receiving Production values. Resources use Production runtime values only. An explicitly empty string is a value, not a deletion. Hook values are used only when the corresponding hook is configured.

## Save and deploy

The editor shows configured key names, their origin, and replacement inputs. Leaving a replacement input untouched preserves the value. Replacing it with an empty string explicitly saves an empty value. Concurrent edits are rejected; refresh and reapply the intended changes.

**Save** stores changes for the next execution. It does not restart containers or enqueue deployment. Deploy the affected app or resource separately when you are ready. Build changes require rebuilding the image. Runtime changes require a replacement deployment. Image rollback uses current secrets and does not restore revoked credentials.

Preview defaults and app values can be saved independently and are used by later eligible Preview deployments. Towbar rechecks pull request eligibility and rejects deployment while another deployment or cleanup is active.

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

Mutations accept `{ "expectedRevision": null, "set": { "KEY": "new value" }, "delete": [] }`. Use `null` only for an unconfigured slot, then use its returned revision for later edits. Send only explicitly changed values; metadata and placeholders are never replacement values. A stale revision returns HTTP 409. Metadata includes local and inherited key names, revisions, and pending changes. Secret mutations never enqueue work.

Server metadata and writes use `GET` and `PATCH /v1/core/servers/{id}/credentials`, with `privateKey` and `apiToken` fields. All public secret responses contain metadata only and disable caching. Secret writes require a workspace owner. Slack and SMTP provider credentials are installation environment variables and never pass through these APIs.

After saving, queue a production deployment through the existing app/resource deploy action, or a selected preview with `POST /v1/core/previews/{id}/actions/deploy`. Report any queue failure separately from the successful save.

## Storage and recovery

Secret records are encrypted in PostgreSQL using the separately configured 32-byte `TOWBAR_CREDENTIALS_KEY`. Authenticated encryption binds each record to its workspace, owner, environment, stage, and identity. Values are resolved by the API only for execution and sent over the existing authenticated internal worker path; Temporal history, public responses, deployment snapshots, and audit events contain no plaintext values.

Back up the Towbar database and preserve its encryption key separately. Restore both to recover secret configuration. A database-only backup cannot recover secrets without the matching key. Do not replace the key on an existing installation without re-encrypting its stored credentials; there is no automatic key rotation or secret history in this release.

Source syncs preserve editor configuration for existing App and Resource IDs. Archival retains values; permanent owner deletion removes its records. Shared values and servers remain attached to the workspace. A new App identity starts unconfigured, while a new server IP must be added under **Servers** before a Source can reference it. SSH and Cloudflare values stay scoped to that workspace server. Slack and SMTP are configured for the Towbar installation through deployment environment variables.
