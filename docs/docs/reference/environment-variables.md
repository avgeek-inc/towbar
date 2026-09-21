---
title: "Environment variables"
description: "Reference for control-plane secrets, public origins, notification providers, and worker settings."
---

Use this reference when configuring the Towbar installation. Application secrets belong in the [Shared secrets editor](/docs/secrets), and app behavior belongs in the [deployment manifest](/docs/reference/deployment-manifest).

The installer creates `/etc/towbar/towbar.env` with root ownership and mode `600`. Edit it with `sudo towbar config edit`, validate it with `sudo towbar config validate`, and apply changes with `sudo towbar restart`. Compose reads this file when creating containers; editing it alone does not update running services.

## Required installation secrets

| Variable                           | Purpose                                 |
| ---------------------------------- | --------------------------------------- |
| `TOWBAR_POSTGRES_PASSWORD`         | PostgreSQL owner and migration password |
| `TOWBAR_DATABASE_RUNTIME_PASSWORD` | Restricted API database password        |
| `TOWBAR_CREDENTIALS_KEY`           | Encrypts stored secrets and credentials |
| `TOWBAR_INTERNAL_HMAC_SECRET`      | Signs API and worker internal requests  |

Generate the PostgreSQL passwords and HMAC secret independently with
`openssl rand -hex 32`. Hex output is URL-safe for the Compose database URLs.
`TOWBAR_CREDENTIALS_KEY` must instead be a separate 32-byte Base64 value from
`openssl rand -base64 32 | tr -d '\n'`; Towbar rejects any other decoded key
length.

## Public origins

Set the Towbar origin before building images. Browser bundles embed the API
origin at build time. The website URL is an external navigation target; the Compose stack does not host the Mintlify website.

| Variable                  | Example                      |
| ------------------------- | ---------------------------- |
| `TOWBAR_API_BASE_URL`     | `https://towbar.example`     |
| `TOWBAR_APP_BASE_URL`     | `https://towbar.example`     |
| `TOWBAR_WEBSITE_BASE_URL` | `https://www.towbar.example` |

Use the same origin for the app and API. Route `/v1/*` to the API listener on
port `4020` and every other path to the web listener on port `4021`. Login is
rendered by the web app and sends credentialed requests to that same origin.

The default `TOWBAR_BIND_ADDRESS=127.0.0.1` keeps services private to the host.
Terminate TLS at a reverse proxy on that host or a private load balancer.
`TOWBAR_TRUSTED_PROXY_HOPS` defaults to `0`, which ignores forwarding headers
and uses the direct socket address for authentication throttling. The public
installer sets it to `1` for one directly connected reverse proxy. Change it
only to the exact number of controlled proxy hops in front of the API, and
prevent direct access to port `4020` whenever the value is greater than zero.

## Runtime integrations

Towbar integrations are configured only in the API process environment. The dashboard never accepts or reveals provider credentials. An integration appears in the UI only after its `TOWBAR_<PROVIDER>_ENABLED` flag is `true` and every required value is valid. The API validates all enabled integrations before it begins listening; a partial configuration fails startup instead of leaving a broken provider visible.

Set secret values directly. Towbar does not support `_FILE` variants. Encode multiline values as Base64 where the variable name ends in `_BASE64`, and pass structured maps through the documented JSON variables. Restart the API after changing integration configuration.

### Source control

| Provider     | Required variables                                                                                                                                                | Optional variables                                              |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| GitHub App   | `TOWBAR_GITHUB_ENABLED`, `TOWBAR_GITHUB_APP_ID`, `TOWBAR_GITHUB_APP_SLUG`, `TOWBAR_GITHUB_PRIVATE_KEY_BASE64`, `TOWBAR_GITHUB_WEBHOOK_SECRET`                     | `TOWBAR_GITHUB_API_URL`                                         |
| GitLab OAuth | `TOWBAR_GITLAB_ENABLED`, `TOWBAR_GITLAB_OAUTH_CLIENT_ID`, `TOWBAR_GITLAB_OAUTH_CLIENT_SECRET`, `TOWBAR_GITLAB_OAUTH_REDIRECT_URI`, `TOWBAR_GITLAB_WEBHOOK_SECRET` | `TOWBAR_GITLAB_BASE_URL`, `TOWBAR_GITLAB_ALLOW_PRIVATE_NETWORK` |

GitHub stores only the selected App installation and account metadata in PostgreSQL. GitLab stores only an encrypted, revocable OAuth grant and short-lived PKCE authorization attempts. App identity, OAuth client secrets, webhook secrets, and provider endpoints remain in the runtime environment.

### Registries, storage, secrets, platform, and telemetry

| Provider             | Enable flag                 | Required values                                                                   |
| -------------------- | --------------------------- | --------------------------------------------------------------------------------- |
| OCI registry         | `TOWBAR_REGISTRY_ENABLED`   | `TOWBAR_REGISTRY_HOST`, `TOWBAR_REGISTRY_PASSWORD`; username is optional          |
| AWS                  | `TOWBAR_AWS_ENABLED`        | `TOWBAR_AWS_REGION`, `TOWBAR_AWS_ACCESS_KEY_ID`, `TOWBAR_AWS_SECRET_ACCESS_KEY`   |
| S3 compatible        | `TOWBAR_S3_ENABLED`         | region, access key ID, and secret access key; endpoint/bucket/prefix are optional |
| Cloudflare R2        | `TOWBAR_R2_ENABLED`         | endpoint, region, access key ID, and secret access key                            |
| Google Cloud Storage | `TOWBAR_GCS_ENABLED`        | project ID and `TOWBAR_GCS_SERVICE_ACCOUNT_JSON_BASE64`                           |
| Azure Blob Storage   | `TOWBAR_AZURE_ENABLED`      | storage account, tenant ID, client ID, and client secret                          |
| Infisical            | `TOWBAR_INFISICAL_ENABLED`  | client ID and client secret                                                       |
| Doppler              | `TOWBAR_DOPPLER_ENABLED`    | service token                                                                     |
| Cloudflare           | `TOWBAR_CLOUDFLARE_ENABLED` | account ID and API token                                                          |
| OpenTelemetry        | `TOWBAR_OTLP_ENABLED`       | endpoint; headers are supplied through `TOWBAR_OTLP_HEADERS_JSON`                 |

Use the exact names in the installed configuration file or `.env.example` for optional bucket, prefix, endpoint, addressing-style, private-network, CA, zone, image, dashboard, and protocol fields. Temporary AWS sessions are intentionally unsupported because they cannot be maintained safely as static installation configuration.

### Notifications

Set `TOWBAR_NOTIFICATIONS_ENABLED=true` and place provider credentials plus routes in `TOWBAR_NOTIFICATION_CONFIG_JSON`. The document has a `providers` object for Slack, SMTP, and Telegram credentials, and a `routes` array for enabled category destinations. Discord and generic webhook credentials live directly in their route because each route has its own URL. Route IDs must be unique, and every non-webhook route must have its provider configured.

```json
{
  "providers": {
    "smtp": {
      "from": "towbar@example.com",
      "host": "smtp.example.com",
      "port": 587,
      "secure": false,
      "username": "towbar",
      "password": "replace-me"
    }
  },
  "routes": [
    {
      "id": "operations-email",
      "provider": "smtp",
      "enabled": true,
      "categories": ["deployments", "health"],
      "config": { "recipients": ["operations@example.com"] }
    }
  ]
}
```

The dashboard shows the active providers and routes without returning credentials. Notification events, delivery attempts, provider outcomes, and thread identifiers remain persisted for reliable retries and audit history.

### Log forwarding

Each supported drain has `TOWBAR_LOG_DRAIN_<PROVIDER>_ENABLED` and `TOWBAR_LOG_DRAIN_<PROVIDER>_CONFIG_JSON`. Providers are `NEWRELIC`, `AXIOM`, `BETTERSTACK`, `DATADOG`, `OTLP`, and `LOKI`. The JSON shape is provider-specific and includes the ingest credential. Towbar hashes the JSON to derive a revision; it does not persist the configuration document. Per-server applied state, delivery health, backoff, and diagnostics remain in PostgreSQL.

## Image vulnerability scanning

Set `TOWBAR_VULNERABILITY_SCANNING_ENABLED=true` to make image scanning
available to Repositories. Each App must then opt in explicitly in its deployment
manifest:

```yaml title=".towbar/apps/hello-towbar.app.yml"
id: hello-towbar
vulnerabilityScanning: true
environments:
  production: {}
```

Towbar queues a scan of that App's immutable image digest after each successful
production or Preview deployment. Changing only this App policy does not force
a redeployment, and Resources are not scanned. Towbar reuses one result per
workspace and image digest, stores only bounded normalized findings, and keeps
scan failures separate from deployment health. The deployment detail page
shows severity totals, actionable findings, scanner metadata, and stale or
failed states. Disabling the App policy stops new scans without deleting prior
results.

`TOWBAR_VULNERABILITY_SCAN_MAX_AGE_HOURS` controls when completed results are
labelled stale and defaults to `168` hours. `TOWBAR_TRIVY_IMAGE` configures the
worker-side scanner and must pin both a Trivy tag and image digest. The shipped
default is a reviewed multi-architecture pin. Recreate both the API and worker
after changing scanner configuration:

```bash
sudo towbar compose up --detach --force-recreate api worker
```

See [Vulnerability scanning](/docs/vulnerability-scanning) for workspace findings, scan states, and rescanning.

## Account security

Initial setup requires an installer-issued single-use code. Email recovery, MFA and the local recovery command are documented in [Team access](/docs/self-hosting/team-access). The v1 owner-reset environment variables are not supported.

`TOWBAR_PASSWORD_BREACH_CHECK` defaults to `true`; explicitly setting `false` supports isolated installations without the password corpus service. `TOWBAR_PASSWORD_VERIFY_CONCURRENCY` defaults to `2` (range 1–8), and `TOWBAR_PASSWORD_VERIFY_QUEUE_LIMIT` defaults to `16` (range 1–100). Benchmark resource usage before raising these limits. Saturation returns a retryable busy response.

## Servers and worker capacity

Register IP addresses, SSH access, and concurrency under [Servers](/docs/servers). These settings do not belong in the manifest. Cloudflare and [AWS credentials](/docs/integrations/aws) are optional runtime integrations configured in the API environment.

| Variable                                  | Default                    | Purpose                                                  |
| ----------------------------------------- | -------------------------- | -------------------------------------------------------- |
| `TOWBAR_WORKER_MAX_CONCURRENT_ACTIVITIES` | `4`                        | Global worker activity capacity                          |
| `TOWBAR_APP_ID`                           | `towbar-worker` in Compose | Manifest app identity for worker self-deployment cleanup |
| `TOWBAR_BIND_ADDRESS`                     | `127.0.0.1`                | Published Compose port binding                           |
| `TOWBAR_API_PORT`                         | `4020`                     | API port on the host                                     |
| `TOWBAR_APP_PORT`                         | `4021`                     | Dashboard port on the host                               |
| `TOWBAR_TEMPORAL_UI_PORT`                 | `8233`                     | Temporal UI port on the host                             |
| `TOWBAR_NETWORK_NAME`                     | `towbar-platform`          | Compose network name                                     |

Keep worker activity capacity above the largest server build-concurrency setting, leaving room for sync and maintenance. Restrict the Temporal UI to administrators.

## Browser observability

`NEXT_PUBLIC_SENTRY_DSN` is optional. When using it, configure the dashboard build with the intended value and review what your Sentry project collects.

## Installation and upgrades

Towbar installation and upgrades run on the control-plane host. See [Install Towbar](/docs/self-hosting/installation) for the installer and [Upgrades and recovery](/docs/self-hosting/upgrades) for the CLI upgrade process.

## API and MCP rate limits

`TOWBAR_API_RATE_LIMIT_MAX` defaults to `60` requests and
`TOWBAR_API_RATE_LIMIT_WINDOW_SECONDS` defaults to `60` seconds. The API and
MCP share persistent per-key and per-IP limits. Set both variables on the API process;
restart it after changes. Configure `TOWBAR_TRUSTED_PROXY_HOPS` for your proxy
topology so clients are counted correctly. See [API authentication and rate
limits](/docs/api/authentication) for bounds, response headers, and examples.
