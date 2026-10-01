# Independent OCI services and datastores

This validation example deploys five separate Towbar entities on one private
network: SigNoz server, ingestion collector, and ClickHouse Keeper as image
Services, plus PostgreSQL and ClickHouse as managed Datastores. Towbar has no
SigNoz-specific runtime behavior.

The configuration is adapted from the [Foundry deployment snapshot](https://github.com/SigNoz/foundry/tree/db8a859301d373812680fe5c01d6c6564918438d/docs/examples/docker/compose/pours/deployment),
which was also Foundry `main` when checked on October 1, 2026. The candidate
images are `signoz/signoz:v0.144.0`,
`signoz/signoz-otel-collector:v0.144.12`,
`clickhouse/clickhouse-server:25.12.5`, and
`clickhouse/clickhouse-keeper:25.12.5` on Linux ARM64. ClickHouse is pinned to its
OCI index digest because custom managed datastore images require a digest.
PostgreSQL uses Towbar's supported default image. This example is deployment
validation, not a supported release compatibility matrix.

Copy this directory into a deployment repository and replace `192.0.2.10` in
the five entity files. Keep automation disabled while deploying the stack in
operator-selected order. Prepare the target server and map `production` to a
branch.

## Prepare the executable file

Run `node prepare-histogram.mjs` before committing your deployment repository.
It downloads the Linux ARM64 histogram executable from the upstream
`histogram-quantile/v0.0.1` release, verifies the archive SHA-256 against the
published checksum, and writes `config/histogramQuantile`. Review and commit
that file alongside the configuration. Towbar reads it from the immutable
repository snapshot and mounts it read-only with mode `0555`; it does not
download or execute a host initialization script. The binary is intentionally
not stored in Towbar's own example tree.

## Save values through Towbar

Save the required variables in each workload's secret editor. These include
non-secret image settings because Towbar currently supplies all runtime
variables through the same flow. Keep credentials and credential-bearing DSNs
out of source-controlled files.

- PostgreSQL: set `POSTGRES_DB` and `POSTGRES_USER` to `signoz`, and choose a
  strong `POSTGRES_PASSWORD`.
- ClickHouse: set `CLICKHOUSE_USER` to `default`, choose a strong
  `CLICKHOUSE_PASSWORD`, set `CLICKHOUSE_CONFIG` to
  `/etc/clickhouse-server/config-0-0.yaml`, and set
  `CLICKHOUSE_SKIP_USER_SETUP` to `1`. The reviewed YAML reads the password
  through ClickHouse's `from_env` attribute, including remote cluster access.
- Collector: set `SIGNOZ_OTEL_COLLECTOR_CLICKHOUSE_DSN` to an authenticated DSN
  for private host `clickhouse`, port `9000`; set
  `SIGNOZ_OTEL_COLLECTOR_TIMEOUT` to `10m`. Save those same values independently
  under **Runtime** and **Pre-deploy**. The hook receives only its hook bundle.
- SigNoz: set `SIGNOZ_SQLSTORE_PROVIDER` to `postgres`,
  `SIGNOZ_SQLSTORE_POSTGRES_DSN` to an authenticated DSN for private host
  `postgres`, port `5432`, database `signoz`,
  `SIGNOZ_TELEMETRYSTORE_PROVIDER` to `clickhouse`, and
  `SIGNOZ_TELEMETRYSTORE_CLICKHOUSE_DSN` to an authenticated DSN for private
  host `clickhouse`, port `9000`.

URL-encode credential components when forming DSNs. The collector configuration
uses its DSN environment variable; no plaintext credentials are interpolated
into retained configuration files.

## Deploy and verify

Deploy Keeper, PostgreSQL, ClickHouse, Collector, and SigNoz in that order,
waiting for each deployment to succeed. There is no dependency scheduler across
independent deployables. The collector's pre-deploy shell exits on the first
failure while running `migrate ready`, `migrate bootstrap`, `migrate sync up`,
and `migrate async up`. Its startup command then requires `migrate sync check`
to succeed before starting ingestion.

The collector accepts OTLP HTTP on `4318` while Towbar checks HTTP readiness on
`13133`. Keeper uses a container command health check. ClickHouse retains the
standard managed data volume, with a read-only executable file mounted beneath
its user-scripts directory. All entities receive their declared private aliases.
This fixture declares no public domains and does not expose OTLP gRPC on `4317`
outside the private network. Declare an appropriate public HTTP probe with
`health.publicPath` when adding ingress on a port separate from readiness.

On a fresh SigNoz database, complete first-run administrator registration in
the SigNoz UI before sending telemetry. The OpAMP-managed collector waits for
the first organization before starting its ingestion pipeline, even though the
server and collector readiness endpoints already respond successfully. The
isolated test registers a disposable administrator and verifies an OTLP HTTP
request on `4318` after the management handshake completes.

Run the production deployer over an isolated non-root SSH/Docker target:

```sh
pnpm --filter @workspace/towbar-deployer... build
node tools/e2e/oci-runtime-lifecycle.mjs
node tools/e2e/independent-oci-lifecycle.mjs
```

Only the source archive response and release-commit callback are fixtures. Image
pulls, Docker startup, private DNS, migrations, datastore connections, HTTP
readiness, and executable-function calls run for real. No production workload,
public TLS, API admission, Temporal delivery, or release publication is involved.
Rollback restores files and images; it does not reverse database migrations.
