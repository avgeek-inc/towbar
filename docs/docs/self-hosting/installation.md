---
title: "Install Towbar"
description: "Run the Towbar control plane with Docker Compose and create your first Admin account."
---

Towbar runs on infrastructure you manage. The Compose stack includes the dashboard, API, worker, PostgreSQL, and Temporal. Deployment targets are registered separately after installation.

## Before you begin

Use a dedicated Ubuntu or Debian host with persistent storage and outbound HTTPS access. The installer uses Docker's official APT repository when Docker is not already available. If the host already has Docker, it must include Compose v2. For a public installation, create an A record for the Towbar hostname, point it at this host, and allow inbound TCP traffic on ports 80 and 443 before running the installer.

The examples use loopback addresses for initial setup. Keep that binding until you have created the first Admin account.

## Preview the onboarding

You can review the complete terminal experience on macOS or Linux without root access, Docker, or filesystem changes:

```bash
./infra/towbar preview
```

The preview uses a compact built-in terminal interface. If [Gum](https://github.com/charmbracelet/gum) is already installed, Towbar uses it for the input and confirmation controls. Gum is optional and is never installed by Towbar. Use `./infra/towbar preview --defaults` for a non-interactive preview.

The installer asks only for the URL where the control plane will be reached. Press Enter to keep the default `http://localhost:4021` on-host installation, or enter a public HTTPS origin whose A record points to the host. Other localhost ports, HTTPS localhost URLs, URL paths, custom ports, and non-HTTPS remote URLs are rejected. Review the result, then confirm the installation.

Towbar generates the database passwords, credential-encryption key, and internal signing secret. It does not ask for provider credentials during installation. Optional integrations remain disabled until their environment variables are added later.

## Install the control plane

Review and run the installer as root:

```bash
curl -fsSL https://raw.githubusercontent.com/avgeek-inc/towbar/main/install.sh | sudo bash
```

The installer places the current CLI at `/usr/local/bin/towbar`. The CLI verifies the selected published release, resolves it to an immutable commit, installs it under `/opt/towbar/releases`, and starts the Compose stack. It generates the PostgreSQL, runtime-database, credential-encryption, and internal-signing secrets once. Existing Docker installations are preserved; Docker upgrades remain managed by the host package manager.

During installation, the CLI:

1. Inspects the host and installs the required system packages.
2. Installs Docker Engine and Compose v2 when they are absent.
3. Verifies the installer's exact published release and resolves its tag to an immutable commit.
4. Downloads the release and creates the root-owned runtime configuration.
5. Builds the API, worker, and dashboard images.
6. Applies the database and Temporal schemas.
7. For a public URL, verifies DNS and ports 80 and 443, then starts the bundled Caddy gateway.
8. Obtains a Let's Encrypt certificate, verifies the public HTTPS endpoint, and rehearses a gateway restart using the persisted certificate.
9. Verifies each long-running service and prints a one-time browser setup link.

The browser setup asks for the team name, administrator display name, email address, password, and password confirmation. Provider credentials, SMTP, notification destinations, deployment servers, and repositories are configured after the first Admin signs in.

To review every executable before installation, download the CLI directly:

```bash
curl -fsSLo towbar \
  https://raw.githubusercontent.com/avgeek-inc/towbar/main/infra/towbar
less towbar
sudo install -o root -g root -m 0755 towbar /usr/local/bin/towbar
sudo towbar install
```

The installer is versioned with Towbar. It installs the exact release declared inside the downloaded installer rather than resolving a moving `latest` release. The installed CLI verifies that release on GitHub and resolves its tag to an immutable commit before downloading source.

## Configure the installation

Towbar keeps operator configuration outside versioned release directories at `/etc/towbar/towbar.env`. The file is owned by root with mode `600`, remains in place across upgrades, and can be edited with the host editor of your choice:

```bash
sudo nano "$(towbar config path)"
sudo towbar config validate
sudo towbar restart
```

For an internet-reachable installation, Towbar uses `TOWBAR_APP_BASE_URL` as the single HTTPS origin for the dashboard, REST API, MCP, webhooks, streaming responses, and terminal transport. `TOWBAR_WEBSITE_BASE_URL` is an external link target; Towbar does not run the website in this repository.

The bundled Caddy gateway binds ports 80 and 443, obtains a Let's Encrypt certificate, redirects HTTP to HTTPS, and renews the certificate automatically. Its certificate and ACME account data live in persistent Docker volumes and survive upgrades and container replacement. The installer validates Caddy's configuration, verifies the live certificate, restarts the gateway once, and confirms that HTTPS recovers with the persisted certificate.

Towbar does not create or modify DNS records and cannot open a cloud firewall or security group. A public installation stops with an actionable error when the hostname has no A record, ports 80 or 443 are already occupied, certificate issuance fails, or the public HTTPS endpoint cannot be reached. Fix the reported prerequisite and rerun the installation.

If certificate issuance fails after the containers start, the installer prints the recent Caddy output, removes the incomplete stack, and releases ports 80 and 443. It never exposes a public HTTP fallback. Generated secrets, the downloaded release, database data, and Caddy's ACME state remain available so `sudo towbar install` can resume safely. Entering a different valid domain on the retry updates the access settings without replacing the generated secrets.

The gateway routes `/v1/*` to the API and all other paths to the dashboard, so those service boundaries do not leak into host configuration. The default local installation instead publishes only `127.0.0.1:4021`; it does not bind public HTTP or HTTPS ports.

Use `towbar config path` with any editor that can save the root-owned file. Towbar does not wrap the editor or retain configuration copies. Back up the file through your normal host configuration-management or secret-management process before changing it.

The configuration commands are deliberately limited:

| Command                       | Behavior                                                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `towbar config path`          | Prints the active environment-file path. It does not read or display the file.                                         |
| `sudo towbar config validate` | Checks Compose, API, worker, integrations, notifications, log forwarding, and Caddy without changing running services. |
| `sudo towbar restart`         | Builds candidate images and validates API, worker, integration, notification, log-forwarding, and Caddy configuration. |

`restart` does not replace running containers unless every configuration preflight passes. If validation or a candidate build fails, the current services remain running and the CLI directs the operator to `sudo towbar doctor`. If a service fails after replacement begins despite those checks, the CLI stops and also directs the operator to `doctor` for the exact runtime failure.

Useful host commands include:

```bash
sudo towbar status
sudo towbar logs api worker
sudo towbar doctor
sudo towbar version
```

`sudo towbar doctor` performs read-only host, configuration, Docker, service, release, database, and access-mode checks. Public installations also check DNS, HTTPS routing, certificate lifetime, persisted Caddy state, and outbound access needed for releases and certificate renewal. It prints no secret values, returns a nonzero exit code when a required check fails, and supports machine-readable output with `sudo towbar doctor --json`.

Use `sudo towbar upgrade` for later stable releases. See [Upgrades and recovery](/docs/self-hosting/upgrades) before upgrading an installation with production data.

Towbar v2 requires a fresh database and does not upgrade a 1.x installation. Keep any existing instance and backup separate; do not point this release at its database.

Issue a one-time setup link from the API container:

```bash
sudo towbar exec api node dist/cli/setup-code.js
```

Open the printed link and enter the team name, your name, email, password and confirmation. The setup code is placed in the URL fragment and should be kept private. It is consumed atomically; only one initial team/Admin can be created. Issuing a replacement code before setup invalidates the previous code. For local development use `pnpm --filter towbar-api auth:setup-code`.

Complete setup while the services are loopback-bound. Configure SMTP for invitations and password recovery, then add colleagues under Team Settings. See [Team access](/docs/self-hosting/team-access) for roles, MFA and invitations. If access is lost, use [Admin account recovery](/docs/self-hosting/account-recovery).

The loopback defaults provide an on-host dashboard for evaluating and configuring Towbar. External REST, MCP, and API-key management remain unavailable in this mode. Configure a single HTTPS Towbar origin and restart the installation before connecting automation clients or receiving provider webhooks.

## Verify the installation

Open **Manage → System health** and run checks. Confirm the API and database, Temporal, and worker checks are healthy. GitHub can remain unconfigured until you connect a GitHub App.

The `migrate`, `temporal-schema`, and `temporal-namespace` containers are one-time jobs and should exit successfully. The API, worker, web app, PostgreSQL, and Temporal should continue running. If startup fails, run `sudo towbar logs migrate temporal-schema temporal temporal-namespace api worker`.

Temporal uses pinned upstream server and administration images. Startup applies versioned SQL schemas and creates the default namespace if absent. Repeating startup preserves existing workflow state. Do not delete PostgreSQL volumes to resolve a startup failure.

Temporal's gRPC and HTTP APIs are accessible only inside the control-plane network. Its operator UI binds to `127.0.0.1` even if you change `TOWBAR_BIND_ADDRESS` for the dashboard and API. Access the operator UI through an SSH tunnel; it is not protected by Towbar's dashboard login and must not be exposed publicly.

## Continue setup

Connect [GitHub](/docs/integrations/github), register and prepare a [server](/docs/servers), then follow [Your first deployment](/docs/getting-started). For public ingress and optional providers, use the [environment variable reference](/docs/reference/environment-variables).
