---
title: "Upgrades and recovery"
description: "Plan a release upgrade, protect control-plane state, and recover Admin access."
---

Upgrade the API, worker, and dashboard together from a reviewed release. Before changing versions, read the [changelog](https://github.com/avgeek-inc/towbar/blob/main/CHANGELOG.md) for migration requirements.

## Prepare an upgrade

1. Pause automatic deployments and allow active operations to finish.
2. Back up the Towbar PostgreSQL database with your infrastructure tooling. Preserve `.env` and its credential-encryption key separately with restricted access.
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

## Towbar v2 requires a fresh installation

The v2 database starts with `001_team_access_v2`. It does not support upgrading a 1.x schema, importing its password hashes or replaying its migration history. Use a separate fresh database and retain the previous instance/database/encryption key for recovery. Never delete an existing database as an upgrade step. Reconfigure the new instance explicitly before moving workload management to it.

For later v2 releases, keep the usual backup and migration review process above. Downgrading application images does not roll back database changes.

## Admin account recovery

Use **Forgot password** when SMTP and the account's mailbox are available. Host operators can reset an Admin password, change a lost Admin email address, or reset an authenticator for any active team member. Follow [Account recovery](/docs/self-hosting/account-recovery) for the maintenance window, commands, revoked access, and verification steps.

## Automatic release deployment

The included `Deploy release` workflow supports a generic Linux server over SSH
and EC2 through AWS Systems Manager. Follow [Deploy with GitHub
Actions](/docs/self-hosting/github-actions) to prepare the server, protect the
GitHub environment, pin the SSH host key or AWS OIDC identity, and run the
first exact-tag deployment.
