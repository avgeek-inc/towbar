<p align="center">
  <a href="https://www.towbar.dev">
    <img src="docs/assets/towbar-logo.png" alt="Towbar" width="88" height="88" />
  </a>
</p>

<h1 align="center">Towbar</h1>

<p align="center"><strong>Open-source, Git-native PaaS</strong></p>
<p align="center">Deploy anything to servers you own, defined via Git repositories.<br />Previews, monitoring, and batteries included.</p>

<p align="center">
  <a href="https://www.towbar.dev">Website</a> ·
  <a href="https://www.towbar.dev/docs">Documentation</a> ·
  <a href="https://www.towbar.dev/blog/introducing-towbar">Introducing Towbar</a> ·
  <a href="https://github.com/avgeek-inc/towbar/issues">Issues</a>
</p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/release-v2/overview-dark.jpg" />
  <img src="docs/assets/release-v2/overview-light.jpg" alt="Towbar overview showing deployment trends, running workloads, servers, incidents, and recent deployments." width="1280" />
</picture>

Towbar is a self-hosted control plane for deploying and operating apps,
databases, and supporting services on infrastructure you control. Workloads are
declared in the repository beside the code that uses them. Towbar reads an
immutable commit, validates the declaration, and turns it into a traceable
deployment.

There is no hosted Towbar control plane. Repository credentials, integration
credentials, workload secrets, deployment history, and operational state remain
on your Towbar instance.

## Why Towbar

- **Git is the source of truth.** Apps, resources, Compose projects,
  environments, build settings, domains, health checks, jobs, and policies are
  reviewed with the code they operate.
- **Deployments use immutable inputs.** Source revisions and OCI image digests
  identify what ran, while health checks decide whether a candidate is promoted.
- **Environments stay separate.** Map production, staging, and other
  environments to branches while keeping instances, secrets, containers, and
  persistent data isolated.
- **Pull requests can get real previews.** Eligible apps receive isolated
  routes, secrets, status updates, and automatic cleanup without copying
  persistent production resources.
- **Operations live beside delivery.** Follow logs, metrics, incidents,
  vulnerability findings, scheduled jobs, backups, restores, and deployment
  comparisons from the same control plane.
- **The servers remain yours.** Towbar deploys over SSH to ordinary Ubuntu
  servers and uses Docker, Caddy, PostgreSQL, and Temporal rather than a
  proprietary runtime.

## What is included

| Area            | Capabilities                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Source control  | GitHub App and GitLab OAuth connections, branch-mapped environments, immutable archive sync, push and pull-request automation        |
| Applications    | Dockerfile, static, Railpack, Nixpacks, Cloud Native Buildpacks, OCI image, and Docker Compose deployments                           |
| Databases       | Managed PostgreSQL, MySQL, MariaDB, MongoDB, Redis, Dragonfly, KeyDB, and ClickHouse resources                                       |
| Delivery        | Rolling and recreate strategies, health-gated promotion, rollback, hooks, scheduled jobs, domains, TLS, and build servers            |
| Data protection | Scheduled native backups, restore validation, retention policies, and S3, GCS, Azure Blob Storage, R2, or S3-compatible destinations |
| Observability   | Scout Agent metrics, alerts, incidents, public uptime checks, deployment comparisons, logs, and image vulnerability scanning         |
| Integrations    | Private OCI registries, external secrets, notifications, log forwarding, Cloudflare, and OpenTelemetry                               |
| Access          | Admin, Member, and Viewer roles, invitations, passkeys, authenticator 2FA, scoped API keys, sessions, and audit history              |
| Automation      | REST API and MCP for HTTPS installations, with the same workspace permissions and scoped API keys as the dashboard                   |

## Install Towbar

Use a dedicated Ubuntu or Debian host. Press Enter during installation for an
on-host `http://localhost:4021` deployment, or enter a public HTTPS hostname
whose A record already points to the server. For HTTPS installations, Towbar
configures Caddy, obtains a Let's Encrypt certificate, verifies renewal, and
serves the dashboard, REST API, MCP, and webhooks from one origin.

Review and run the installer as root:

```bash
curl -fsSL https://raw.githubusercontent.com/avgeek-inc/towbar/main/install.sh | sudo bash
```

The installer adds the `towbar` CLI, generates installation secrets, pulls the
published multi-architecture images by immutable digest, applies the database
schema, starts the control plane, and verifies its services. It does not ask for
provider or workload credentials.

After installation, open the printed URL, create the first Admin account, then
connect GitHub or GitLab and register an Ubuntu deployment server.

Read [Install Towbar](https://www.towbar.dev/docs/self-hosting/installation) for
host requirements, public DNS and HTTPS setup, configuration, and recovery
behavior. The [CLI guide](https://www.towbar.dev/docs/self-hosting/cli) covers
status, logs, validation, restart, upgrade, backup, diagnostics, and uninstall.

> [!NOTE]
> REST API, MCP, and API-key management are available only on HTTPS
> installations. A localhost-only installation exposes the dashboard on the
> Towbar host and keeps those interfaces disabled.

## Declare a repository

Towbar reads a root `towbar.yml` and entity files under `.towbar/apps/`,
`.towbar/resources/`, and `.towbar/compose/`.

```yaml
# towbar.yml
version: 2
environments:
  production: {}
  staging:
    previews:
      enabled: true
```

Map each environment to a branch in Towbar. Every sync reads one immutable
revision and applies the validated inventory atomically. Manifest files contain
the required secret names, while encrypted values stay in Towbar and out of Git.

Start with the [example configuration](examples/) or follow
[Your first deployment](https://www.towbar.dev/docs/getting-started). The
[deployment manifest](https://www.towbar.dev/docs/deployment-manifest) documents
the complete schema with focused examples.

## Architecture

The control plane runs as a Docker Compose stack:

- the **dashboard** presents deployment and operational state;
- the **API** owns validation, authorization, persistence, REST, MCP, and
  real-time transports;
- the **worker** executes durable Temporal workflows;
- **PostgreSQL** stores control-plane state;
- **Temporal** coordinates deployments and long-running operations; and
- the optional **Caddy gateway** provides one HTTPS origin and automatic TLS.

Target servers run the workloads Towbar manages. Scout Agent is opt-in and
reports server and container measurements back to the control plane.

Read the [architecture guide](https://www.towbar.dev/docs/architecture) for the
service boundaries, repository layout, data model, workflow path, security
model, and direct links into the implementation.

## Documentation

- **[Introduction](https://www.towbar.dev/docs)** — concepts, architecture,
  installation, CLI, first deployment, and migration guides.
- **[Deploy](https://www.towbar.dev/docs/apps)** — repositories, servers, apps,
  resources, releases, previews, domains, secrets, and manifest fields.
- **[Databases](https://www.towbar.dev/docs/databases)** — supported engines,
  configuration, health checks, backups, and restores.
- **[Operate](https://www.towbar.dev/docs/monitoring)** — Scout Agent,
  performance, alerts, incidents, vulnerability scanning, troubleshooting, and
  workspace access.
- **[Integrations](https://www.towbar.dev/docs/integrations)** — source control,
  registries, backup destinations, external secrets, platform services,
  notifications, and log forwarding.
- **[API & MCP](https://www.towbar.dev/docs/api)** — authentication, endpoints,
  MCP tools, and automation workflows.

Moving an existing workload? Start with the candid migration guides for
[Coolify](https://www.towbar.dev/docs/migrate-from-coolify),
[Dokploy](https://www.towbar.dev/docs/migrate-from-dokploy),
[CapRover](https://www.towbar.dev/docs/migrate-from-caprover),
[Dokku](https://www.towbar.dev/docs/migrate-from-dokku),
[Heroku](https://www.towbar.dev/docs/migrate-from-heroku),
[Railway](https://www.towbar.dev/docs/migrate-from-railway),
[Render](https://www.towbar.dev/docs/migrate-from-render), or
[Vercel](https://www.towbar.dev/docs/migrate-from-vercel).

## Contribute

Bug reports, feature requests, documentation improvements, and code
contributions are welcome. [Open an issue](https://github.com/avgeek-inc/towbar/issues)
or read [CONTRIBUTING.md](CONTRIBUTING.md) for the local setup and required
checks. Report vulnerabilities privately through [SECURITY.md](SECURITY.md).

Towbar uses Node.js 24, pnpm 11, and Turborepo. Release history is recorded in
[CHANGELOG.md](CHANGELOG.md).

## License

[Apache License 2.0](LICENSE). Created by **Avgeek, Inc.** and maintained by
[Praveen Thirumurugan](https://github.com/praveentcom).
