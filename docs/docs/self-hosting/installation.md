---
title: "Install Towbar"
description: "Run the Towbar control plane with Docker Compose and create your first Admin account."
---

Towbar runs on infrastructure you manage. The Compose stack includes the dashboard, API, worker, PostgreSQL, and Temporal. Deployment targets are registered separately after installation.

## Before you begin

Use a dedicated Ubuntu or Debian host with persistent storage and outbound HTTPS access. The installer uses Docker's official APT repository when Docker is not already available. If the host already has Docker, it must include Compose v2. For GitHub integration, plan HTTPS origins for the app and API.

The examples use loopback addresses for initial setup. Keep that binding until you have created the first Admin account.

## Preview the onboarding

You can review the complete terminal experience on macOS or Linux without root access, Docker, or filesystem changes:

```bash
./infra/towbar preview
```

The preview uses a compact built-in terminal interface. If [Gum](https://github.com/charmbracelet/gum) is already installed, Towbar uses it for the choice, input, and confirmation controls. Gum is optional and is never installed by Towbar. Use `./infra/towbar preview --defaults` for a non-interactive preview.

The installer asks only how the control plane will be reached:

1. Choose whether Towbar stays on the server or is published through an existing HTTPS reverse proxy.
2. For public HTTPS, enter the dashboard URL, API URL, and number of trusted proxy hops.
3. Review where Towbar will be available, then confirm the installation.

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
3. Resolves the latest published stable v2 release to its immutable commit.
4. Downloads the release and creates the root-owned runtime configuration.
5. Builds the API, worker, and dashboard images.
6. Applies the database and Temporal schemas.
7. Starts the control plane and verifies each long-running service.
8. Prints a one-time browser setup link.

The browser setup asks for the team name, administrator display name, email address, password, and password confirmation. Provider credentials, SMTP, notification destinations, deployment servers, and repositories are configured after the first Admin signs in.

To review every executable before installation, download the CLI directly:

```bash
curl -fsSLo towbar \
  https://raw.githubusercontent.com/avgeek-inc/towbar/main/infra/towbar
less towbar
sudo install -o root -g root -m 0755 towbar /usr/local/bin/towbar
sudo towbar install
```

Set `TOWBAR_VERSION` to install a specific published stable release:

```bash
curl -fsSL https://raw.githubusercontent.com/avgeek-inc/towbar/main/install.sh | \
  sudo TOWBAR_VERSION=v2.0.0 bash
```

## Configure the installation

Towbar keeps operator configuration outside versioned release directories at `/etc/towbar/towbar.env`. The file is owned by root with mode `600`, remains in place across upgrades, and can be edited directly or through the CLI:

```bash
sudo towbar config edit
sudo towbar config validate
sudo towbar restart
```

For an internet-reachable installation, replace the three base URLs before exposing the service. The API and web app need reachable HTTPS origins; login stays on the web app origin. `TOWBAR_WEBSITE_BASE_URL` is an external link target; Towbar does not run the website in this repository.

The edit command validates a temporary copy before replacing the active file and retains one previous copy for `sudo towbar config rollback`. `restart` rebuilds release images when configuration affects web-app build arguments and restores the previous edited configuration if the replacement fails.

Useful host commands include:

```bash
sudo towbar status
sudo towbar logs api worker
sudo towbar version
```

Use `sudo towbar upgrade` for later stable releases. See [Upgrades and recovery](/docs/self-hosting/upgrades) before upgrading an installation with production data.

Towbar v2 requires a fresh database and does not upgrade a 1.x installation. Keep any existing instance and backup separate; do not point this release at its database.

Issue a one-time setup link from the API container:

```bash
sudo towbar exec api node dist/cli/setup-code.js
```

Open the printed link and enter the team name, your name, email, password and confirmation. The setup code is placed in the URL fragment and should be kept private. It is consumed atomically; only one initial team/Admin can be created. Issuing a replacement code before setup invalidates the previous code. For local development use `pnpm --filter towbar-api auth:setup-code`.

Complete setup while the services are loopback-bound. Configure SMTP for invitations and password recovery, then add colleagues under Team Settings. See [Team access](/docs/self-hosting/team-access) for roles, MFA and invitations. If access is lost, use [Admin account recovery](/docs/self-hosting/account-recovery).

The loopback defaults are suitable for evaluating the UI on the host. GitHub
webhooks require the API URL to be reachable over HTTPS, so a complete
push-to-deploy setup also needs a maintained reverse proxy or private ingress.

## Verify the installation

Open **Manage → System health** and run checks. Confirm the API and database, Temporal, and worker checks are healthy. GitHub can remain unconfigured until you connect a GitHub App.

The `migrate`, `temporal-schema`, and `temporal-namespace` containers are one-time jobs and should exit successfully. The API, worker, web app, PostgreSQL, and Temporal should continue running. If startup fails, run `sudo towbar logs migrate temporal-schema temporal temporal-namespace api worker`.

Temporal uses pinned upstream server and administration images. Startup applies versioned SQL schemas and creates the default namespace if absent. Repeating startup preserves existing workflow state. Do not delete PostgreSQL volumes to resolve a startup failure.

Temporal's gRPC and HTTP APIs are accessible only inside the control-plane network. Its operator UI binds to `127.0.0.1` even if you change `TOWBAR_BIND_ADDRESS` for the dashboard and API. Access the operator UI through an SSH tunnel; it is not protected by Towbar's dashboard login and must not be exposed publicly.

## Continue setup

Connect [GitHub](/docs/integrations/github), register and prepare a [server](/docs/servers), then follow [Your first deployment](/docs/getting-started). For public ingress and optional providers, use the [environment variable reference](/docs/reference/environment-variables).
