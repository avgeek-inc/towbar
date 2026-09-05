---
title: "Install Towbar"
description: "Run the Towbar control plane with Docker Compose and create your owner account."
---

Towbar runs on infrastructure you manage. The Compose stack includes the dashboard, API, worker, PostgreSQL, and Temporal. Deployment targets are registered separately after installation.

## Before you begin

Use a Linux host with Docker Engine, Compose v2, Git, and OpenSSL. You also need persistent storage for PostgreSQL and outbound access to download images and dependencies. For GitHub integration, plan HTTPS origins for the app and API.

The examples use loopback addresses for initial setup. Keep that binding until you have created the owner account.

## Install the control plane

Install Docker Engine with Compose v2, Git, and OpenSSL on the control-plane
host. Clone Towbar and create the local environment file:

```bash
git clone https://github.com/avgeek-inc/towbar.git
cd towbar
cp .env.example .env
```

Generate each PostgreSQL password and the HMAC secret independently:

```bash
openssl rand -hex 32
```

Generate the credential-encryption key separately. It must decode to exactly 32
bytes:

```bash
openssl rand -base64 32 | tr -d '\n'
```

Put those values in `.env`. For an internet reachable installation, also
replace the three base URLs before building. The API and web app need reachable
HTTPS origins; login stays on the web app origin. `TOWBAR_WEBSITE_BASE_URL` is
an external link target; Towbar does not run the website in this repository.

Start the stack:

```bash
docker compose up --build --detach --wait
docker compose ps
```

Open `TOWBAR_APP_BASE_URL`; with the default local configuration it is
`http://localhost:4021`. Towbar sends the first visitor to `/login` and a
one-time setup form for the owner name, email, and password. The API serializes
that creation and locks setup permanently after the first account exists.
Complete setup while the services are still loopback-bound, before enabling
public ingress.

If the owner password is later forgotten, use the environment-and-restart
procedure in [Configuration](/docs/self-hosting/upgrades#forgotten-owner-password).
Towbar has no browser-accessible password-reset flow.

The loopback defaults are suitable for evaluating the UI on the host. GitHub
webhooks require the API URL to be reachable over HTTPS, so a complete
push-to-deploy setup also needs a maintained reverse proxy or private ingress.

## Verify the installation

Open **Manage → System health** and run checks. Confirm the API and database, Temporal, and worker checks are healthy. GitHub can remain unconfigured until you connect a GitHub App.

The `migrate` container is a one-time job and should exit successfully. The API, worker, web app, PostgreSQL, and Temporal should continue running. If startup fails, inspect `docker compose logs --tail 200 migrate api worker` before retrying.

## Continue setup

Connect [GitHub](/docs/integrations/github), register and prepare a [server](/docs/servers), then follow [Your first deployment](/docs/getting-started). For public ingress and optional providers, use the [environment variable reference](/docs/reference/environment-variables).
