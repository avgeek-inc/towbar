---
title: "Upgrades and recovery"
description: "Plan a release upgrade, protect control-plane state, and recover Admin access."
---

Upgrade the API, worker, and dashboard together from a reviewed release. Before changing versions, read the [changelog](https://github.com/avgeek-inc/towbar/blob/main/CHANGELOG.md) for migration requirements.

## Prepare an upgrade

1. Pause automatic deployments and allow active operations to finish.
2. Preserve the file reported by `towbar config path` and its credential-encryption key with restricted access.
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

The CLI accepts only published, non-prerelease semantic versions in its own major version. It resolves the tag to an immutable Git commit, downloads that commit archive into `/opt/towbar/releases`, validates the release image manifest, pulls the API, worker, and dashboard images by immutable digest, validates `/etc/towbar/config.yml`, applies migrations, waits for service health, and verifies the commit reported by the API. After a failed service replacement, the CLI attempts to restore the previous release symlink and images. A previous image alone is not a recovery plan for a database migration; review migration compatibility before reverting a release.

The target release must have a successful **Publish release images** workflow. If its image manifest is not attached yet, the CLI stops before replacing the current release.

The updated CLI renames an existing `/etc/towbar/towbar.yml` to `/etc/towbar/config.yml` during upgrade, preserving its contents and permissions. If both paths exist, the upgrade stops so an operator can resolve the conflict without losing either file. An upgrade started with an older CLI installs the updated CLI first; run `sudo towbar restart` afterward to complete the rename. The repository-root `towbar.yml` manifest is unrelated and stays unchanged.

After a successful upgrade, Towbar retains the current and immediately previous source release and application images. Older Towbar release directories and unreferenced Towbar application images are removed. Database, Temporal, Caddy, and application volumes are never pruned, and images belonging to other Docker workloads are not touched.

The CLI keeps configuration outside release directories. Edit and apply it independently:

```bash
sudo nano "$(towbar config path)"
sudo towbar config validate
sudo towbar restart
```

Do not replace `security.credentialsKey`: existing encrypted records require the matching key. Changing database values in the file does not rotate credentials inside the existing PostgreSQL volume.

## Admin account recovery

Use **Forgot password** when SMTP and the account's mailbox are available. Host operators can reset an Admin password, change a lost Admin email address, or reset an authenticator for any active team member. Follow [Account recovery](/docs/self-hosting/account-recovery) for the maintenance window, commands, revoked access, and verification steps.

## Command-line operations

Towbar does not deploy itself from GitHub Actions. Installation and upgrades run on the control-plane host through the `towbar` CLI, so release access and `/etc/towbar/config.yml` remain host-owned. See the [Towbar CLI guide](/docs/self-hosting/cli) for every command, parameter, safety check, and troubleshooting workflow.

## Upgrade from System Health

Host-managed upgrades are opt-in. First install a release that includes the host upgrade runner using the existing CLI path. On the control-plane host, enable it:

```bash
sudo towbar upgrade-service enable
sudo systemctl status towbar-upgrade
```

Enabling the service restarts Towbar with a private runner socket mounted into the API. Schedule this setup during a maintenance window. It requires a standard upstream CLI installation at `/opt/towbar`, configuration at `/etc/towbar`, the CLI at `/usr/local/bin/towbar`, Python 3, Linux with systemd, and Docker Compose v2. Custom paths, forks, container-only Compose installs, Kubernetes, and older releases without the admission protocol retain the manual CLI path. Both the installed and target releases must support protocol 2, which includes dedicated-group access and runner updates. Use a host maintenance window for a protocol or major-version migration; the current CLI accepts only its own major version.

Setup creates a dedicated system group and saves its identity in the root-only `/etc/towbar/upgrade-group.json`. If `towbar-upgrade` already names a host group, setup chooses a new name rather than adopting it. The generated Compose override grants only the API container the group's numeric ID through `group_add`; it does not add host users. Startup rejects a saved group that has host members, a primary user, another group sharing its ID, or a changed ID. The runtime directory, token, and socket belong to root and this group, never a fixed host group ID.

To replace an older setup, first wait for the upgrade to finish and check its result. Stop the idle service with `sudo systemctl stop towbar-upgrade`, then run `sudo towbar upgrade-service enable` from the compatible installed release. Enabling refuses to stop an already-running service. Startup rotates the token and reapplies the dedicated group permissions; setup recreates the API with the generated supplemental group.

An Admin with a recently authenticated browser session can select **Review upgrade** in **System Health** when a newer stable release is available. The confirmation shows the installed and target versions, a changelog link, and readiness blockers. Preparation downloads the immutable release archive and validates its image manifest; it can take a few minutes. Confirmation expires after 15 minutes. A changed installed release or target Git commit requires a new check.

Keep a recent, tested database backup and a protected copy of the configuration and encryption key before confirming. The upgrade runner does not create backups. It rejects queued or active deployments, source syncs, resource operations, checks, preparations, credential checks, image scans, preview cleanup, worker activities, and server terminals. Finish or resolve this work before retrying.

On confirmation, a database barrier pauses new admissions before the runner checks readiness again. All deployment insert paths share this barrier, including manual, webhook, scheduled, rollback, and preview deployments. Each worker activity acquires a recorded lease before performing work. Delayed Temporal work cannot execute effects while admission is paused. Blocked attempts reopen admission without replacing services. Webhook requests rejected during the pause need redelivery or a source sync afterward; the upgrade runner does not buffer webhooks.

The host service invokes the existing CLI with the confirmed version and commit. The CLI validates the published stable release and immutable image digests, migrates, replaces services, and checks health. The confirmation modal shows progress and the final result. Closing it, closing the browser, or replacing the API does not stop the job. Select **View upgrade** in System Health to reopen the latest status. During an API restart the page polls for reconnection; a disconnect alone is neither success nor failure. Repeating a request identifier returns the same attempt instead of starting another upgrade.

After verifying the installed release, the runner installs that release's runner code and systemd unit without stopping the active job. It reopens admission, saves the successful result, and requests a service restart. New upgrade requests are blocked while that restart is pending. If installation fails, admission remains paused; if restart fails after admission reopens, the saved failure reports that deployments and operations can start and requires recovery before another upgrade. Recovery also installs the current release's runner and restarts it after saving the recovered result.

When the service is enabled, `sudo towbar upgrade [VERSION]` also uses this admission and job path. The runner exposes only status, release preparation, and confirmed upgrade requests over an authenticated Unix socket. The API receives no Docker socket, root privileges, shell endpoint, or configurable command path. Only a root host connection can acknowledge recovery. The worker and dashboard do not mount the runner socket.

## Recover a host-managed attempt

Attempts and private CLI output are stored in `/var/lib/towbar-upgrade`, outside containers. Read the latest job record and check service health on the control-plane host:

```bash
sudo systemctl status towbar-upgrade
sudo journalctl -u towbar-upgrade
sudo cat /var/lib/towbar-upgrade/job.json
sudo towbar doctor
sudo towbar logs migrate api worker
```

Use the `id` field in `/var/lib/towbar-upgrade/job.json` to locate `/var/lib/towbar-upgrade/ATTEMPT-ID.log` for the CLI output. The browser shows a safe failure reason or the last known upgrade stage and exit code; it does not show raw exception text or command output. These root-only logs can contain operational details. Keep them protected and apply your own retention policy.

A failed CLI run may have attempted to restore the previous symlink and images. It does **not** reverse database migrations. Check which release is running and whether the schema remains compatible. Restore the database and configuration from a tested backup if migration recovery requires it. Do not infer a successful rollback from an available dashboard alone.

A runner restart marks an unfinished attempt **interrupted** and never starts it again automatically. Failures before reopening admission leave new deployments and operations paused. If reopening succeeds but saving the result fails, deployments and operations can already start again; the runner reports this and blocks another upgrade until host recovery is acknowledged. An interrupted reopening may have taken effect even without a saved result, so inspect the admission state on the host. After checking services, the database, and pending work, explicitly resume:

```bash
sudo towbar upgrade-service resume --acknowledge-recovery
```

Resume checks `towbar doctor`, refuses unresolved blockers, and only clears the pause belonging to the recorded attempt. Worker and terminal leases do not expire automatically: an interrupted SSH operation may still be changing a remote host. Inspect leases with:

```bash
sudo towbar compose exec -T postgres psql -U towbar -d towbar -c \
  'SELECT id, kind, created_at FROM towbar_upgrade_leases ORDER BY created_at;'
```

Before clearing a stale lease, stop the worker, close server terminals, and verify that the corresponding remote operation has ended. Resolve its deployment or operation record as well. A host database administrator can then delete that specific lease by ID; never truncate the lease table or clear leases based only on age. Run the recovery command and restart the worker after the remaining blockers are resolved. Normal queued work resumes after admission reopens.

If the API cannot reconnect, continue recovery over SSH. Repair the database or services with the host CLI; do not run the upgrade inside a container. Leave the runner state and admission record intact until you have established the outcome.
