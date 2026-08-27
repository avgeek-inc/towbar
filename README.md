# Towbar

[![Towbar — Git-backed deployments to servers you own](docs/assets/towbar-open-graph.png)](https://www.towbar.dev)

Towbar is an opinionated, source-driven deployment platform for Ubuntu servers
you own. It treats a repository's `.towbar/deployment.yml` as infrastructure
truth and runs deployments through durable Temporal workflows.

> [!IMPORTANT]
> Towbar is under active development. Read [SECURITY.md](SECURITY.md) and the
> [architecture guide](docs/architecture.md) before exposing an installation to
> the internet.

## Highlights

- GitHub repositories and versioned manifests define Sources, Servers, Apps,
  Resources, domains, and deployment policy.
- Builds run on the target host, without requiring a container registry.
- AWS Secrets Manager values are resolved just in time and stay out of Git.
- SSH host-key pinning, server preparation, health checks, and queued
  deployments are built in.
- Opt-in branch Previews use stable URLs, isolated secrets, and automatic
  cleanup without changing production health or release history.
- PostgreSQL and Temporal provide persistent state and durable execution.

## Quick start

Requirements: Docker Engine with Compose v2, Git, and OpenSSL.

```bash
git clone https://github.com/avgeek-inc/towbar.git
cd towbar
cp .env.example .env
```

Replace every placeholder in `.env`, then start Towbar:

```bash
docker compose up --build --detach --wait
```

Open `http://localhost:4021` and create the first owner account. Continue with
the [getting-started guide](docs/getting-started.md) to connect GitHub, add a
Source, prepare a server, and make the first deployment.

## Documentation

- [Getting started](docs/getting-started.md)
- [Configuration](docs/configuration.md)
- [Deployment manifest](https://www.towbar.dev/docs/deployment-file)
- [Architecture](docs/architecture.md)
- [Changelog](CHANGELOG.md)
- [Security policy](SECURITY.md)

## Development

Towbar uses Node.js 24, pnpm 11, and Turborepo.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
```

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Towbar is
authored by **Avgeek, Inc.** and maintained by
[Praveen Thirumurugan (@praveentcom)](https://github.com/praveentcom).

## License

Licensed under the [Apache License 2.0](LICENSE).
