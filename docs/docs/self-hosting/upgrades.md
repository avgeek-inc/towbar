---
title: "Upgrades and recovery"
description: "Plan a release upgrade, protect control-plane state, and recover Admin access."
---

Upgrade the API, worker, and dashboard together from a reviewed release. Before changing versions, read the [changelog](https://github.com/avgeek-inc/towbar/blob/main/CHANGELOG.md) for migration requirements.

## Prepare an upgrade

1. Pause automatic deployments and allow active operations to finish.
2. Back up the Towbar PostgreSQL database with your infrastructure tooling. Preserve `/etc/towbar/towbar.env` and its credential-encryption key separately with restricted access.
3. Run `sudo towbar version` and record the installed release.
4. Review the target release and its migration notes.
5. Run the CLI upgrade, inspect migration output, and verify System health before resuming deployments.

Upgrade to the latest published stable release:

```bash
sudo towbar upgrade
sudo towbar status
sudo towbar logs migrate api worker
```

To install a reviewed version explicitly, pass its release tag:

```bash
sudo towbar upgrade v2.1.0
```

The CLI accepts only published, non-prerelease v2-or-later semantic versions. It resolves the tag to an immutable Git commit, downloads that commit archive into `/opt/towbar/releases`, validates the release image manifest, pulls the API, worker, and dashboard images by immutable digest, validates `/etc/towbar/towbar.env`, applies migrations, waits for service health, and verifies the commit reported by the API. A failed service replacement restores the previous release symlink and images. A previous image alone is not a recovery plan for a database migration; review migration compatibility before reverting a release.

The target release must have a successful **Publish release images** workflow. If its image manifest is not attached yet, the CLI stops before replacing the current release.

After a successful upgrade, Towbar retains the current and immediately previous source release and application images. Older Towbar release directories and unreferenced Towbar application images are removed. Database, Temporal, Caddy, and application volumes are never pruned, and images belonging to other Docker workloads are not touched.

The CLI keeps configuration outside release directories. Edit and apply it independently:

```bash
sudo nano "$(towbar config path)"
sudo towbar config validate
sudo towbar restart
```

Do not replace `TOWBAR_CREDENTIALS_KEY`: existing encrypted records require the matching key. Changing database values in the file does not rotate credentials inside the existing PostgreSQL volume.

## Towbar v2 requires a fresh installation

The v2 database starts with `001_team_access_v2`. It does not support upgrading a 1.x schema, importing its password hashes or replaying its migration history. Use a separate fresh database and retain the previous instance/database/encryption key for recovery. Never delete an existing database as an upgrade step. Reconfigure the new instance explicitly before moving workload management to it.

For later v2 releases, keep the usual backup and migration review process above. Downgrading application images does not roll back database changes.

## Admin account recovery

Use **Forgot password** when SMTP and the account's mailbox are available. Host operators can reset an Admin password, change a lost Admin email address, or reset an authenticator for any active team member. Follow [Account recovery](/docs/self-hosting/account-recovery) for the maintenance window, commands, revoked access, and verification steps.

## Command-line operations

Towbar does not deploy itself from GitHub Actions. Installation and upgrades run on the control-plane host through the `towbar` CLI, so release access and `/etc/towbar/towbar.env` remain host-owned. Run `towbar help` for the complete command list. `towbar compose COMMAND` passes an administrative command to this installation with the correct release directory, project name, and environment file.
