---
title: "Install Towbar"
description: "Run the Towbar control plane with Docker Compose and create your first Admin account."
---

Towbar runs on infrastructure you manage. The Compose stack includes the dashboard, API, worker, PostgreSQL, and Temporal. Deployment targets are registered separately after installation.

## Before you begin

Use a Linux host with Docker Engine, Compose v2, Git, and OpenSSL. You also need persistent storage for PostgreSQL and outbound access to download images and dependencies. For GitHub integration, plan HTTPS origins for the app and API.

The examples use loopback addresses for initial setup. Keep that binding until you have created the first Admin account.

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

Towbar v2 requires a fresh database and does not upgrade a 1.x installation. Keep any existing instance and backup separate; do not point this release at its database.

Issue a one-time setup link from the API container:

```bash
docker compose exec api node dist/cli/setup-code.js
```

Open the printed link and enter the team name, your name, email, password and confirmation. The setup code is placed in the URL fragment and should be kept private. It is consumed atomically; only one initial team/Admin can be created. Issuing a replacement code before setup invalidates the previous code. For local development use `pnpm --filter towbar-api auth:setup-code`.

Complete setup while the services are loopback-bound. Configure SMTP for invitations and password recovery, then add colleagues under Team Settings. See [Team access](/docs/self-hosting/team-access) for roles, MFA and invitations. If access is lost, use [Admin account recovery](/docs/self-hosting/account-recovery).

The loopback defaults are suitable for evaluating the UI on the host. GitHub
webhooks require the API URL to be reachable over HTTPS, so a complete
push-to-deploy setup also needs a maintained reverse proxy or private ingress.

## Verify the installation

Open **Manage → System health** and run checks. Confirm the API and database, Temporal, and worker checks are healthy. GitHub can remain unconfigured until you connect a GitHub App.

The `migrate`, `temporal-schema`, and `temporal-namespace` containers are one-time jobs and should exit successfully. The API, worker, web app, PostgreSQL, and Temporal should continue running. If startup fails, inspect `docker compose logs --tail 200 migrate temporal-schema temporal temporal-namespace api worker` before retrying.

Temporal uses pinned upstream server and administration images. Startup applies versioned SQL schemas and creates the default namespace if absent. Repeating startup preserves existing workflow state. Do not delete PostgreSQL volumes to resolve a startup failure.

Temporal's gRPC and HTTP APIs are accessible only inside the control-plane network. Its operator UI binds to `127.0.0.1` even if you change `TOWBAR_BIND_ADDRESS` for the dashboard and API. Access the operator UI through an SSH tunnel; it is not protected by Towbar's dashboard login and must not be exposed publicly.

## Continue setup

Connect [GitHub](/docs/integrations/github), register and prepare a [server](/docs/servers), then follow [Your first deployment](/docs/getting-started). For public ingress and optional providers, use the [environment variable reference](/docs/reference/environment-variables).
