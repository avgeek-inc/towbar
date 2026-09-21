---
title: "Uninstall Towbar"
description: "Stop or remove the control plane while keeping workload and database deletion explicit."
---

The Towbar control plane and the apps deployed to target servers have separate lifecycles. Removing the control plane leaves deployed containers, app files, resource databases, and host services in place. You can keep those workloads running, migrate them elsewhere, or remove them separately.

## Before stopping Towbar

1. Pause automatic deployments and scheduled operations. Let active deployments, backups, restores, and server preparation finish.
2. Keep a verified copy of the Towbar PostgreSQL database and the matching `.env` in restricted storage. Encrypted credentials in the database need `TOWBAR_CREDENTIALS_KEY`. Record the release version and Compose project name.
3. If you are retiring the target servers too, use Towbar's workload and server cleanup controls while the control plane is available. Review each container and volume; volume deletion permanently removes its files.
4. Disable Scout Agent on targets that will continue running independently. Remove or update GitHub webhooks and any external release-deployment automation that still targets this installation.

Do not delete backups or workload volumes as part of stopping Towbar. See [Server cleanup](/docs/servers#clean-up-leftover-workloads) and [Persistent app files](/docs/reference/deployment-manifest#persistent-app-storage) for their separate retention behavior.

## Stop and remove the control plane

SSH into the host and use the installation directory, not a target application's directory:

```bash
cd /opt/towbar
docker compose ps
docker compose down --remove-orphans
```

Replace `/opt/towbar` with the actual directory. Use the same Compose project name (`-p`, if specified) and environment overrides as installation. The command removes this project's containers and network. It retains the PostgreSQL volume, local images, checkout, and `.env`. Towbar API, dashboard, scheduler, and worker are now stopped.

To resume with the retained state:

```bash
docker compose up --detach --wait
```

If you exposed Towbar through a reverse proxy, remove only its own routing entries. Remove its DNS records and firewall rules separately if no other service uses them.

## Permanently remove control-plane data

Do this only after verifying the retained backup and deciding that this installation's database is no longer needed. The database volume also holds Temporal history. It does not hold app or resource volumes on deployment targets.

From the same installation directory and Compose project:

```bash
docker compose down --volumes --remove-orphans
```

The `--volumes` flag permanently deletes the PostgreSQL volume declared by this Compose project. Do not run it during an upgrade or temporary shutdown. Do not use global `docker system prune` or `docker volume prune` as an uninstall step: other applications may share the host.

After removing the stack, you can delete its checkout and `.env` using your usual file-management procedure. Confirm the absolute path first and keep the backup and encryption key outside it. Remove only Towbar-specific proxy settings and unused images; Docker, Caddy, monitoring services, and shared host packages may still be used by other workloads.

## Retire remaining access

Revoke credentials that were dedicated to this installation: its GitHub App installation or webhook secret, cloud storage access, notification credentials, and SSH keys. Remove the corresponding SSH public key from each target's `authorized_keys` only when no replacement control plane needs it. Shared credentials should be rotated with their other consumers rather than deleted blindly.
