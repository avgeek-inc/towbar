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
production deployment activities in a unique Temporal namespace. Deployment
requests use the real admission service and signal the server coordinator, which
starts `runDeploymentWorkflow`, including signed HTTP requests, secret
resolution, release commits, and failure recovery. Assertions require three
completed workflows, one failed workflow, matching database/runtime releases,
and successful replay of all four histories. The worker, API listener, test rows
and Docker target are closed afterward. Stop the dedicated Temporal server when
finished; its workflow histories remain available until then.

Source sync snapshots, instances, and server readiness are seeded in PostgreSQL.
The runner verifies admission, idempotent retries, server coordinator delivery,
and execution. It does not exercise browser/API authentication for deployment
requests or GitHub source synchronization.

## Non-root vulnerability scanning

```sh
pnpm --filter towbar-worker build
node tools/e2e/trivy-lifecycle.mjs
```

This runner executes the production Trivy script over SSH as the non-root
`deploy` user on the isolated Linux target. It downloads the pinned scanner and
its vulnerability database, scans an Alpine image, and checks the parsed result.
A negative control mounts the private parent directory instead of the readable
archive and must fail with a Linux permission error. Successful scans, permission
failures and missing-image failures must all remove temporary archives.

The scanner keeps the production restrictions, including dropped capabilities,
a read-only root filesystem and an offline image scan. The cache lives in the
nested Docker daemon and is removed with the target. Network access to the image
registry and vulnerability database is required. This verifies scanner execution
and cleanup; scheduling and presentation of findings need separate coverage.

## Application build lifecycle

```sh
pnpm --filter @workspace/towbar-deployer... build
node tools/e2e/app-lifecycle.mjs
```

This runner builds a small HTTP app from two controlled source archives. The
production deployer fetches the exact requested commit, extracts and transfers
the archive, mounts a BuildKit secret, builds the image, starts a container with
runtime values, and checks health over HTTP. Three instances share the same
logical app ID but have separate production, staging and preview runtime IDs.
The runner updates staging to the second revision and fails a preview candidate,
checking that the other instances and the previous healthy preview stay intact.

Only the GitHub archive response and release-commit callback are simulated.
Unexpected fetches fail. Docker builds, SSH, health checks and runtime recovery
are real. Public domains/TLS, API admission and PR eligibility/reconciliation are
outside this runner. It does not prove complete PR lifecycle support.
