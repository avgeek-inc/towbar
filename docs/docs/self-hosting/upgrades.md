---
title: "Upgrades and recovery"
description: "Plan a release upgrade, protect control-plane state, and recover owner access."
---

Upgrade the API, worker, and dashboard together from a reviewed release. Before changing versions, read the [changelog](https://github.com/avgeek-inc/towbar/blob/main/CHANGELOG.md) for migration requirements.

## Prepare an upgrade

1. Pause automatic deployments and allow active operations to finish.
2. Back up the Towbar PostgreSQL database. Preserve `.env` and its credential-encryption key separately with restricted access.
3. Record the running release and commit, and confirm the working tree contains no local code changes that the upgrade would overwrite.
4. Check out the reviewed release, build and recreate the Compose stack, and inspect migration output.
5. Verify System health, then deploy a small app and check its actual route before resuming automatic deployment.

After selecting the release commit, recreate the stack and review startup:

```bash
docker compose up --build --detach --wait
docker compose ps
docker compose logs --tail 200 migrate api worker
```

A previous image alone is not a recovery plan for a database migration. Review migration compatibility before reverting a release. Do not replace `TOWBAR_CREDENTIALS_KEY`: existing encrypted records require the matching key.

## Upgrading from 1.4.0 to 1.5.0

1.5.0 changes server ownership, manifest configuration, and integration storage.
The migrations intentionally reset the settings listed below; they do not copy
old credential values into the new ownership model.

1. Pause automatic deployments and wait for active deployments, backups, and
   restores to finish. Back up the Towbar database and preserve `.env` and the
   matching `TOWBAR_CREDENTIALS_KEY`. Confirm you can retrieve the server SSH keys,
   Cloudflare tokens, AWS credentials, and notification provider credentials from
   your own secure records before starting. Towbar's secret fields are write-only.
2. Update each repository's manifest: remove its top-level `servers` block and
   retain the `server` IP on every App and Resource. Host SSH/proxy/concurrency
   settings now belong in **Servers → server → Settings → Configuration**.
3. Set notification provider configuration in the installation `.env` before
   recreating the stack. Slack uses `TOWBAR_SLACK_BOT_TOKEN`; SMTP uses
   `TOWBAR_SMTP_HOST`, `TOWBAR_SMTP_FROM`, and the port/TLS/authentication settings
   your provider requires. See [environment variables](/docs/reference/environment-variables).
4. Check out the reviewed `v1.5.0` release and recreate the stack as shown above.
   Inspect migration and startup output before continuing.
5. Review every server. Servers are deduplicated by workspace and IP, and existing
   server credential records are deleted. Re-enter SSH and any Cloudflare
   credentials, review configuration and trusted host keys, and run server checks.
   Checks, preparation records, and host keys belonging to removed duplicates do
   not transfer to the retained record.
6. Open **Integrations → Cloud providers → AWS** and add the workspace credential
   if you use S3 backups/restores. The former source AWS credential table is
   dropped without importing its values. Verify that the workspace credential can
   access every bucket and prefix used by your Resources.
7. Verify GitHub, AWS, and notification provider setup and send a test notification
   to the configured destinations. The old stored Slack/SMTP provider secrets are
   deleted; provider setup now comes from the environment variables in step 3.
8. Sync Sources, resolve reported configuration errors, and deploy a small app.
   Verify its actual HTTPS route before resuming automatic deployments. If you
   use backups, verify a backup and a restore on a disposable Resource.

Stored deployment plans and their GitHub checks are also removed. Deployment
history remains the place to inspect actual deployment attempts.

If recovery is needed after migrations run, stop the upgraded services and restore
both the pre-upgrade database backup and the matching previous release/configuration.
The release workflow's image/checkout fallback does **not** restore the database.

## Forgotten owner password

Towbar deliberately exposes no public forgot-password or reset-password route.
Recovery is an explicit control-plane restart operation:

1. Generate a high-entropy temporary password with `openssl rand -base64 32`.
2. Set `TOWBAR_OWNER_RESET_EMAIL` to the existing owner email and
   `TOWBAR_OWNER_RESET_PASSWORD` to that temporary value in `.env`.
3. Run `docker compose up --detach --force-recreate api`.
4. Sign in at `${TOWBAR_APP_BASE_URL}/login` with the temporary password.
5. Change the password under **Account → Profile**.
6. Remove both reset variables and recreate the API container again.

The API fails fast if only one variable is set, if the email is not an enabled
owner, or if the temporary password is shorter than 20 characters. Applying a
reset revokes every existing session. PostgreSQL stores only an HMAC
fingerprint, so an unchanged reset value is not reapplied on a later restart.
The temporary password remains visible to the host/container administrator
while configured, which is why it must be random, short-lived, and removed.

## Automatic release deployment

The `Deploy release` GitHub workflow deploys each stable published release to
one existing Towbar installation. It assumes an AWS role through GitHub OIDC
and runs the release script on the host through Systems Manager; no AWS access
key or SSH private key is stored in GitHub.

Configure these variables on a GitHub environment named `production`:

| Variable                       | Purpose                                      |
| ------------------------------ | -------------------------------------------- |
| `TOWBAR_DEPLOY_AWS_ROLE_ARN`   | OIDC role assumed by the release workflow    |
| `TOWBAR_DEPLOY_AWS_REGION`     | Region containing the managed EC2 instance   |
| `TOWBAR_DEPLOY_INSTANCE_ID`    | Only instance the role may command           |
| `TOWBAR_DEPLOY_PATH`           | Existing checkout; defaults to `/opt/towbar` |
| `TOWBAR_DEPLOY_API_HEALTH_URL` | Optional public API health endpoint          |
| `TOWBAR_DEPLOY_APP_HEALTH_URL` | Optional public app health endpoint          |

Read the repository's OIDC subject prefix with
`gh api repos/<owner>/<repository>/actions/oidc/customization/sub --jq .sub_claim_prefix`,
then trust only `<returned-prefix>:environment:production` in the role's OIDC
policy. This supports GitHub's immutable repository-ID subject without using a
wildcard. Grant `ssm:SendCommand` only for `AWS-RunShellScript` and the target
instance, plus `ssm:GetCommandInvocation` for reporting the result. The
instance must be online in Systems Manager and the deployment directory must
contain a clean Git checkout plus an owner-readable-only `.env` file.
Restrict the environment's deployment branches and tags to the protected
default branch and stable release tags.

The workflow verifies the published tag and package version, streams the
protected default branch's `infra/deploy-release.sh` to SSM, checks out the
exact release commit on the host, builds it there, runs migrations, waits for
Compose health, and verifies the running API commit. A failed replacement
attempts to restore the previous checkout and images.
