---
title: "Managed secrets"
description: "Configure encrypted deployment secrets in Towbar."
---

# Managed secrets

Towbar manages deployment secrets without an AWS Secrets Manager account. Values and assignments live in the editor, separate from `.towbar/deployment.yml`. Owners can create, replace, and delete values. Saved values cannot be revealed or exported through the public API.

## Configure values

| Location                        | Purpose                                                                           |
| ------------------------------- | --------------------------------------------------------------------------------- |
| Source → Settings → Secrets     | Shared production defaults for build, runtime, pre-deploy, and post-deploy stages |
| App → Settings → Secrets        | Production overrides and separate preview values for each stage                   |
| Resource → Settings → Secrets   | Runtime values, including `POSTGRES_PASSWORD` or `REDIS_PASSWORD`                 |
| Server → Settings → Credentials | SSH private key and Cloudflare API token                                          |
| Settings → Notifications        | Installation Slack and SMTP configuration                                         |

Apps inherit Source defaults for the matching production stage. Resources inherit runtime defaults only. A local key overrides the corresponding shared key; deleting that override restores the shared value. An explicitly empty string is a value, not a deletion. Hook values are used only when the corresponding hook is configured. Previews never inherit production or Source values.

The editor shows configured key names, their origin, and replacement inputs. Leaving a replacement input untouched preserves the value. Replacing it with an empty string explicitly saves an empty value. Concurrent edits are rejected; refresh and reapply the intended changes.

**Save** stores changes for the next execution. It does not restart containers or enqueue deployment. **Save and deploy** saves first, then queues deployment; a queue failure does not undo the save. Shared changes list affected apps and resources and let you select deployment targets. Build changes require rebuilding the image. Runtime changes require a replacement deployment. Image rollback uses current secrets and does not restore revoked credentials.

Preview secrets can be saved independently or deployed to selected active pull request environments. Towbar rechecks pull request eligibility and rejects deployment while another deployment or cleanup is active.

Changing `POSTGRES_PASSWORD` in Towbar does not change the password already stored inside an existing PostgreSQL database. Coordinate database password rotation separately. SSH and Cloudflare replacement similarly updates what Towbar uses; it does not provision those credentials at the provider or server.

Enable Cloudflare DNS in the server manifest without a token reference:

```yaml
proxy:
  cloudflare:
    enabled: true
```

## External secret managers

Applications may install and invoke their own secret-manager CLI in a Dockerfile or entrypoint. Towbar needs no provider adapter. Supply only the bootstrap credential through the appropriate Towbar stage.

For builds, use Docker BuildKit secret mounts, for example `RUN --mount=type=secret,id=INFISICAL_TOKEN ...`. Never bake the token into `ARG`, `ENV`, or an image layer. Towbar retains the individual BuildKit mounts and the `TOWBAR_BUILD_ENV_JSON` aggregate mount; that aggregate name is reserved.

For runtime, configure the bootstrap credential as a runtime secret and launch the application through the manager's entrypoint command, such as `infisical run -- ...`. Follow the provider's authentication instructions. Credentials fetched inside the application remain the application's responsibility, including avoiding logging them.

References: [Docker build secrets](https://docs.docker.com/build/building/secrets/) and [Infisical Docker integration](https://infisical.com/docs/documentation/getting-started/docker).

## Public API

Read metadata with `GET /v1/core/{sources|apps|resources}/{id}/secrets?environment=production` (or `preview` for apps). Update a stage with `PATCH /v1/core/{sources|apps|resources}/{id}/secrets/{environment}/{stage}`. Stage identifiers are `build`, `deployment` (runtime), `pre_deploy`, and `post_deploy`.

Mutations accept `{ "expectedRevision": null, "set": { "KEY": "new value" }, "delete": [] }`. Use `null` only for an unconfigured slot, then use its returned revision for later edits. Send only explicitly changed values; metadata and placeholders are never replacement values. A stale revision returns HTTP 409. Metadata includes local and inherited key names, revisions, pending changes, and available deployment targets. Secret mutations never enqueue work.

Server metadata and writes use `GET` and `PATCH /v1/core/servers/{id}/credentials`, with `privateKey` and `apiToken` fields. Notification settings use `GET` and `PATCH /v1/core/settings/notifications/{slack|smtp}` with the same revision and mutation format. All public responses contain metadata only and disable caching. Secret writes and notification provider settings require a workspace owner.

After saving, queue a production deployment through the existing app/resource deploy action, or a selected preview with `POST /v1/core/previews/{id}/actions/deploy`. Report any queue failure separately from the successful save.

## Storage and recovery

Secret records are encrypted in PostgreSQL using the separately configured 32-byte `TOWBAR_CREDENTIALS_KEY`. Authenticated encryption binds each record to its workspace, owner, environment, stage, and identity. Values are resolved by the API only for execution and sent over the existing authenticated internal worker path; Temporal history, public responses, deployment snapshots, and audit events contain no plaintext values.

Back up the Towbar database and preserve its encryption key separately. Restore both to recover secret configuration. A database-only backup cannot recover secrets without the matching key. Do not replace the key on an existing installation without re-encrypting its stored credentials; there is no automatic key rotation or secret history in this release.

Source syncs preserve editor configuration for existing app IDs and server IPs. Archival retains values; permanent owner deletion removes its records. A new app identity or server IP starts unconfigured. SSH and Cloudflare values stay scoped to their server; Slack and SMTP stay scoped to the installation workspace.

## Breaking cutover

1. Pause deployments and finish active operations before upgrading the API and worker together.
2. Back up the database and encryption key, then run the database migration.
3. Remove all secret fields from the manifest, including root/shared, app, resource, hook, preview, server login, and Cloudflare token references. Sync the Source.
4. Enter credentials and environment values through the editor. Reconfigure Slack/SMTP in Settings; their old installation environment variables are ignored.
5. Check and prepare servers as needed, deploy a canary, and verify its actual health and public route before resuming work.

There is no AWS import, fallback resolver, or legacy manifest support. Optional S3 backup/restore credentials remain under Source settings. Towbar's own database, encryption, internal authentication, and GitHub bootstrap credentials remain installation configuration.
