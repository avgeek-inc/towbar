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

## Upgrade legacy image workloads

Older releases allowed arbitrary images as resources. The image-to-service migration keeps their existing workload IDs, saved secrets, volumes, and deployment history. It stops the upgrade if an image shares its manifest ID with an app in the same repository, or if its settings cannot be used by a Service. The failed migration leaves the database unchanged.

### Resolve a legacy image ID conflict

The migration error lists the repository, manifest ID, and image entity UUID for each conflict. Choose a new manifest ID for the image, such as `infisical-image`. Keep the existing entity and workload UUIDs so the saved secrets and history remain connected.

1. Back up the database and configuration. Keep deployments paused and stop the API and worker while changing the identity, so repository syncs cannot create a replacement workload.
2. Change the image's `id` in the repository manifest for every environment branch that declares it. Update any references to that ID. Keep the image, network alias, volume names, and stored secret values unchanged.
3. Open a PostgreSQL session on the control-plane host. Run the transaction below with the image entity UUID from the error and your new manifest ID. It updates all environments of that image together. A missing entity or conflicting ID stops the transaction.
4. Retry the upgrade before starting the API and worker. Afterward, convert the repository's image resource declaration to a `.service.yml` manifest with the same new ID, sync the repository, and check its saved secrets and deployment history before deploying.

```sql
BEGIN;
DO $$
DECLARE
  image_entity uuid := 'IMAGE-ENTITY-UUID';
  new_manifest_id text := 'infisical-image';
  repository_id uuid;
BEGIN
  IF new_manifest_id !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$' THEN
    RAISE EXCEPTION 'Choose a valid manifest ID';
  END IF;
  SELECT source_id INTO repository_id
  FROM towbar_source_entities
  WHERE id = image_entity AND entity_type = 'resource' AND resource_type = 'image'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The image entity was not found';
  END IF;
  IF EXISTS (
    SELECT 1 FROM towbar_source_entities
    WHERE source_id = repository_id AND manifest_id = new_manifest_id
      AND id <> image_entity
  ) THEN
    RAISE EXCEPTION 'The new manifest ID is already used in this repository';
  END IF;
  UPDATE towbar_source_entities SET manifest_id = new_manifest_id
  WHERE id = image_entity;
  UPDATE towbar_apps
  SET manifest_id = new_manifest_id,
      config = jsonb_set(config, '{id}', to_jsonb(new_manifest_id))
  WHERE entity_id = image_entity;
END $$;
COMMIT;
```

Historical deployment snapshots keep the ID used at the time of deployment. Do not delete and re-import the workload, change its UUID, or recreate its secret records to resolve this conflict.

### Legacy image volume settings

Services require absolute application data paths such as `/data` or `/app/uploads`. Mounts cannot use `/`, a trailing slash, repeated slashes, `.` or `..` segments, or protected directories such as `/etc`, `/proc`, `/sys`, `/dev`, `/run`, and `/var/run`. Each volume needs a unique name, and mount paths cannot overlap.

If the migration reports an incompatible mount, keep the upgrade paused. Back up the volume and adapt the application to a supported data path on the installed release first. Keep its named volume and verify the application can still read its existing data. The migration also checks saved deployment snapshots; an incompatible historical snapshot requires operator review before retrying. Do not remove a volume or its data just to pass the check.

## Admin account recovery

Use **Forgot password** when SMTP and the account's mailbox are available. Host operators can reset an Admin password, change a lost Admin email address, or reset an authenticator for any active team member. Follow [Account recovery](/docs/self-hosting/account-recovery) for the maintenance window, commands, revoked access, and verification steps.

## Command-line operations

Towbar does not deploy itself from GitHub Actions. Installation and upgrades run on the control-plane host through the `towbar` CLI, so release access and `/etc/towbar/config.yml` remain host-owned. See the [Towbar CLI guide](/docs/self-hosting/cli) for every command, parameter, safety check, and troubleshooting workflow.

## Upgrade from System Health

An Admin can upgrade from **System Health → Towbar version** after the installation operator enables in-app upgrades. Keep a recent database backup and a protected copy of the configuration before upgrading.

1. Select **Review upgrade** when the yellow **Update available** badge appears.
2. Review the version change and the readiness check. If deployments or operations are active, wait for them to finish, then select **Check again**.
3. Select **Upgrade** to begin. New deployments and operations pause while Towbar applies the update.
4. Keep the modal open to follow progress. It reconnects automatically if the dashboard loses contact during a restart.
5. Check the final result in the same modal. A successful upgrade shows the installed version; a failed upgrade links to the recovery instructions below. You can reopen the modal with **View upgrade**.

These screenshots show a local example of upgrading from v2.0.16 to v2.0.17. Availability on your installation depends on its installed version and the latest published release.

<Tabs>
  <Tab title="Ready">

<div className="towbar-doc-screenshot">
  <div className="towbar-product-light">
    <img src="/assets/release-v2/upgrade-ready-light.jpg" alt="Review the new version and the readiness check before upgrading." width="3200" height="1800" loading="lazy" />
  </div>
  <div className="towbar-product-dark">
    <img src="/assets/release-v2/upgrade-ready-dark.jpg" alt="Review the new version and the readiness check before upgrading." width="3200" height="1800" loading="lazy" />
  </div>
  <p>Review the new version and the readiness check before upgrading.</p>
</div>
  </Tab>
  <Tab title="Work in progress">

<div className="towbar-doc-screenshot">
  <div className="towbar-product-light">
    <img src="/assets/release-v2/upgrade-blocked-light.jpg" alt="Wait for active deployments and operations to finish, then check again." width="3200" height="1800" loading="lazy" />
  </div>
  <div className="towbar-product-dark">
    <img src="/assets/release-v2/upgrade-blocked-dark.jpg" alt="Wait for active deployments and operations to finish, then check again." width="3200" height="1800" loading="lazy" />
  </div>
  <p>Wait for active deployments and operations to finish, then check again.</p>
</div>
  </Tab>
  <Tab title="In progress">

<div className="towbar-doc-screenshot">
  <div className="towbar-product-light">
    <img src="/assets/release-v2/upgrade-applying-light.jpg" alt="The same modal follows the upgrade and reconnects during a restart." width="3200" height="1800" loading="lazy" />
  </div>
  <div className="towbar-product-dark">
    <img src="/assets/release-v2/upgrade-applying-dark.jpg" alt="The same modal follows the upgrade and reconnects during a restart." width="3200" height="1800" loading="lazy" />
  </div>
  <p>The same modal follows the upgrade and reconnects during a restart.</p>
</div>
  </Tab>
  <Tab title="Successful">

<div className="towbar-doc-screenshot">
  <div className="towbar-product-light">
    <img src="/assets/release-v2/upgrade-succeeded-light.jpg" alt="The result confirms the installed version and that deployments and operations can resume." width="3200" height="1800" loading="lazy" />
  </div>
  <div className="towbar-product-dark">
    <img src="/assets/release-v2/upgrade-succeeded-dark.jpg" alt="The result confirms the installed version and that deployments and operations can resume." width="3200" height="1800" loading="lazy" />
  </div>
  <p>The result confirms the installed version and that deployments and operations can resume.</p>
</div>
  </Tab>
  <Tab title="Failed">

<div className="towbar-doc-screenshot">
  <div className="towbar-product-light">
    <img src="/assets/release-v2/upgrade-failed-light.jpg" alt="A failed upgrade shows a safe reason and links to recovery help." width="3200" height="1800" loading="lazy" />
  </div>
  <div className="towbar-product-dark">
    <img src="/assets/release-v2/upgrade-failed-dark.jpg" alt="A failed upgrade shows a safe reason and links to recovery help." width="3200" height="1800" loading="lazy" />
  </div>
  <p>A failed upgrade shows a safe reason and links to recovery help.</p>
</div>
  </Tab>
</Tabs>

### Enable in-app upgrades

Standard CLI installations enable in-app upgrades automatically after a successful install or upgrade. The host must use the upstream installation paths, Linux with systemd, and a release that supports the host upgrade service.

If an older CLI installed or upgraded Towbar without enabling the service, run this once on the control-plane host:

```bash
sudo towbar upgrade-service enable
sudo systemctl status towbar-upgrade
```

Setup restarts Towbar with a private runner socket mounted into the API. It requires a standard upstream CLI installation at `/opt/towbar`, configuration at `/etc/towbar`, the CLI at `/usr/local/bin/towbar`, Python 3, Linux with systemd, and Docker Compose v2. Custom paths, forks, container-only Compose installs, Kubernetes, and older releases without the admission protocol retain the manual CLI path. Both the installed and target releases must support protocol 2, which includes dedicated-group access and runner updates. Use a host maintenance window for a protocol or major-version migration; the current CLI accepts only its own major version.

Setup creates a dedicated system group and saves its identity in the root-only `/etc/towbar/upgrade-group.json`. If `towbar-upgrade` already names a host group, setup chooses a new name rather than adopting it. The generated Compose override grants only the API container the group's numeric ID through `group_add`; it does not add host users. Startup rejects a saved group that has host members, a primary user, another group sharing its ID, or a changed ID. The runtime directory, token, and socket belong to root and this group, never a fixed host group ID.

To replace an older setup, first wait for the upgrade to finish and check its result. Stop the idle service with `sudo systemctl stop towbar-upgrade`, then run `sudo towbar upgrade-service enable` from the compatible installed release. Enabling refuses to stop an already-running service. Startup rotates the token and reapplies the dedicated group permissions; setup recreates the API with the generated supplemental group.

Reviewing an upgrade requires an Admin with a recently authenticated browser session. Preparation downloads the immutable release archive and validates its image manifest; it can take a few minutes. Confirmation expires after 15 minutes. A changed installed release or target Git commit requires a new check.

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
