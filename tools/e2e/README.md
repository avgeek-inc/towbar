# Isolated deployment target

Run from the repository root:

```sh
node tools/e2e/target.mjs
```

The harness builds a disposable Linux target with SSH and its own Docker daemon.
It requires Docker support for privileged containers (Docker Desktop or Colima).
It does not mount the host Docker socket or reuse the host daemon's workload
containers and volumes. Only SSH is published, on a random loopback port.

The smoke check connects as the non-root `deploy` user and compares daemon IDs
to verify isolation. It also checks executable paths required by the deployer.
The generated SSH key, container and anonymous volumes are removed on completion
or setup failure. The reusable `towbar-v2-e2e-target:local` image remains cached.

`startTestTarget()` returns the SSH port, private key path, `ssh(command)` and
`close()` for a lifecycle runner. Always call `close()` in `finally`.

This target currently supports private app/resource deployment testing. It does
not emulate Ubuntu systemd or Caddy setup, and its smoke check does not verify
API admission, Temporal workflows, deployments, backups or PR handling.

## Resource deployment lifecycle

```sh
pnpm --filter @workspace/towbar-deployer... build
node tools/e2e/resource-lifecycle.mjs
```

This runner calls the production `executeDeployment` implementation over SSH to
an Ubuntu target. It deploys two Redis instances with the same logical ID on
separate networks, writes distinct data, redeploys staging, and deliberately
fails a staging candidate's health check. Assertions check retained data in both
environments, recovery of staging's previous container, and candidate cleanup.
The target includes real Docker and Caddy binaries; systemd and public TLS setup
are not exercised.

The runner supplies resolved configuration/secrets and an in-memory release
commit callback. It verifies the deployer, not API admission, database release
transactions or Temporal delivery. Those need the subsequent lifecycle runner.

For database-backed execution, build the API and supply a dedicated PostgreSQL
URL whose database name ends in `_test`:

```sh
pnpm --filter towbar-api build
TOWBAR_TEST_DATABASE_URL=postgres://user:password@localhost:5432/towbar_test node tools/e2e/resource-lifecycle.mjs
```

This mode runs migrations, creates an isolated workspace with production and
staging mappings, stores encrypted credentials and environment secrets, and
uses the production API services to resolve execution contexts and commit
releases. It verifies that current database releases match the running
containers and that the unhealthy candidate has no release. Test rows are
removed afterward; use a disposable test database.

The runner calls services directly. It does not exercise HTTP admission or
Temporal delivery, and the unsuccessful candidate remains at `checking_health`
until test cleanup because workflow failure handling is not part of this mode.

## Temporal resource lifecycle

Start a dedicated local Temporal development server in a separate terminal:

```sh
temporal server start-dev --ip 127.0.0.1 --port 17239 --headless
```

Build the API, deployer and worker, then run:

```sh
pnpm --filter towbar-api build
pnpm --filter towbar-worker build
TOWBAR_TEST_TEMPORAL_ADDRESS=127.0.0.1:17239 \
TOWBAR_TEST_DATABASE_URL=postgres://user:password@localhost:5432/towbar_test \
node tools/e2e/resource-lifecycle.mjs
```

This mode serves the production internal API on a random loopback port and runs
production deployment activities on a unique Temporal task queue. Each deployment
runs through `runDeploymentWorkflow`, including signed HTTP requests, secret
resolution, release commits, and failure recovery. Assertions require three
completed workflows, one failed workflow, matching database/runtime releases,
and successful replay of all four histories. The worker, API listener, test rows
and Docker target are closed afterward. Stop the dedicated Temporal server when
finished; its workflow histories remain available until then.

Deployment requests are seeded directly in PostgreSQL. This verifies execution,
not user-facing admission, source synchronization, or server queue coordination.
