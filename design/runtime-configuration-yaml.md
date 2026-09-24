# Towbar runtime configuration in YAML

## Scope

Make `/etc/towbar/towbar.yml` the single operator-edited source for self-hosted
installation and runtime configuration. This replaces the current
`/etc/towbar/towbar.env` and the JSON strings embedded in it. It does not move
control-plane records such as notification destinations, subscriptions, or
delivery history out of the database.

The YAML file contains secrets, so it must be owned by `root:root` with mode
`0600`, like the current environment file. The CLI must never print its contents
or include values in migration errors.

## Shape

```yaml
version: 1

installation:
  mode: public
  appUrl: https://towbar.example.com
  gatewayDomain: towbar.example.com
  bindAddress: 127.0.0.1
  port: 4021
  temporalUiPort: 8233
  networkName: towbar-platform

database:
  postgresPassword: "..."
  runtimePassword: "..."

security:
  credentialsKey: "..."
  internalHmacSecret: "..."
  trustedProxyHops: 1
  passwordBreachCheck: true

worker:
  maxConcurrentActivities: 4

integrations:
  github:
    enabled: true
    appId: "12345"
    appSlug: towbar
    privateKeyBase64: "..."
    webhookSecret: "..."
  # GitLab, registry, AWS, S3, R2, GCS, Azure, Infisical, Doppler,
  # Cloudflare, and OTLP follow the same provider-shaped pattern.

notifications:
  enabled: true
  providers:
    slack:
      botToken: "..."
    discord:
      - webhookId: "123456789012345678"
        webhookToken: "..."
    webhook:
      - id: operations
        label: Operations
        url: https://hooks.example.com/events
        headers:
          Authorization: "Bearer ..."
        signingSecret: "..."

logForwarding:
  newRelic:
    enabled: true
    config:
      # Native YAML fields replace the current CONFIG_JSON string.
      licenseKey: "..."

observability:
  sentry:
    dsn: https://example@sentry.example/1
    environment: production
```

The example shows the hierarchy, not a complete field inventory. The
implementation must map every supported active key from `.env.example`,
including rate limits, vulnerability scanning, all integrations, all log
forwarders, and optional browser observability. Provider JSON documents become
native YAML maps and lists. Values that are identifiers or secrets remain
strings even when they contain only digits. Defaults may be omitted; the CLI
must render the same effective values as the current release.

`COMPOSE_PROFILES`, image references, and other installation mechanics are
derived instead of exposed as duplicate editable settings. The GitLab OAuth
redirect URL is retained as a YAML setting for lossless migration from existing
installations; the installer updates it when the access URL changes. The schema validator must reject unknown YAML
fields and duplicate keys. Parsing must not execute tags or resolve external
references.

## Runtime contract

The CLI validates YAML, then renders a private, generated environment file for
Docker Compose. Compose and the API/worker can continue receiving environment
variables internally. Operators edit only `towbar.yml`; `towbar config path`
points to it, and `config validate`, `restart`, `upgrade`, and `doctor` all use
the same validated rendering path. The generated file must be root-owned,
mode `0600`, written atomically, and refreshed whenever the YAML changes.

This boundary avoids coupling the YAML migration to every container's existing
environment parser. The generated file is an implementation artifact and must
not become a second source of truth.

## Migration from 2.0.11 and earlier

1. Detect the source format by file presence: an existing YAML file wins and
   must never be overwritten; a fresh installation creates YAML directly.
   Read `/opt/towbar/VERSION` for diagnostics and compatibility checks, but do
   not use it as the only migration trigger. The 2.0.11 CLI writes the new
   version _before_ installing the new CLI, so a compatibility upgrade can
   leave a newer version number beside a legacy `towbar.env`.
2. If only `towbar.env` exists, parse all supported active entries from the
   2.0.11-and-earlier format (including a host that has passed through the
   compatibility release). Refuse duplicate keys, malformed values, and
   unknown active keys, reporting key names only. Parse JSON-valued settings
   into native YAML maps and lists.
3. Write `towbar.yml` to a temporary file in `/etc/towbar`, set `root:root`
   and `0600`, validate it, render the environment file, and compare effective
   settings with the original. Rename the YAML file into place only after all
   checks pass. Re-running the migration must be safe.
4. Preserve the original `towbar.env` for rollback until a YAML-based release
   has started and passed health checks. A failed upgrade keeps the previous
   release and its environment file usable. Do not log secrets or create a
   database/snapshot backup as part of this configuration conversion.
5. After the successful cutover, keep a clearly named legacy copy only for the
   rollback window, then remove it through a later explicit cleanup path. The
   generated Compose environment file remains private and derived.

## Release ordering constraint

An existing 2.0.11 installation runs the **2.0.11 CLI code** when it invokes
`towbar upgrade`. That CLI validates `towbar.env` and installs the downloaded
release's CLI only after the new services are healthy and the installed version
has been written. Therefore migration code added to the next CLI cannot run
before the first upgrade's service replacement.

The first YAML-capable release must remain compatible with `towbar.env` during
that upgrade. Its newly installed CLI can then convert the configuration on
the next privileged `towbar` operation, before any service changes, while
supporting both formats during the transition. Only a later release can require YAML. An
alternative one-command cutover would need a separately delivered bootstrap
upgrader that replaces the CLI before starting the upgrade; the existing
2.0.11 `towbar upgrade` command cannot provide that behavior by itself.

## Verification before release

- Convert representative local and public 2.0.11 fixtures, including every
  supported integration, notification provider, log forwarder, and special
  character in a secret; compare the effective rendered environment.
- Exercise repeated migration, existing YAML, unknown keys, invalid JSON,
  malformed YAML, interrupted atomic writes, and rollback after service
  failure.
- Run a real upgrade from the published 2.0.11 CLI into the compatibility
  release, then run the YAML-aware CLI and verify `config validate`, `restart`,
  `doctor`, and another upgrade.
