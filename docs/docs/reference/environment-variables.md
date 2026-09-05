---
title: "Environment variables"
description: "Reference for control-plane secrets, public origins, notification providers, and worker settings."
---

Use this reference when configuring the Towbar installation. Application secrets belong in the [Shared secrets editor](/docs/secrets), and app behavior belongs in the [deployment manifest](/docs/reference/deployment-manifest).

Copy `.env.example` to `.env` in the repository root. Keep it out of Git. Compose reads this file when creating containers; editing it does not update running services.

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

Set all three base URLs before building images. Browser bundles embed public
URLs at build time. The website URL is an external navigation target; the Compose stack does not host the Mintlify website.

| Variable                  | Example                      |
| ------------------------- | ---------------------------- |
| `TOWBAR_API_BASE_URL`     | `https://api.towbar.example` |
| `TOWBAR_APP_BASE_URL`     | `https://app.towbar.example` |
| `TOWBAR_WEBSITE_BASE_URL` | `https://towbar.example`     |

Keep the app and API under the same registrable site, as in the example above,
or proxy the API through that site. Login is rendered by the web app and sends
credentialed requests directly to the API; there is no separate authentication
origin.

The default `TOWBAR_BIND_ADDRESS=127.0.0.1` keeps services private to the host.
Terminate TLS at a reverse proxy on that host or a private load balancer.
`TOWBAR_TRUSTED_PROXY_HOPS` defaults to `0`, which ignores forwarding headers
and uses the direct socket address for authentication throttling. Set it only
to the exact number of trusted proxy hops in front of the API.

## GitHub App

| Variable                        | Purpose                                                    |
| ------------------------------- | ---------------------------------------------------------- |
| `GITHUB_APP_ID`                 | Numeric App ID                                             |
| `GITHUB_APP_SLUG`               | App slug used for installation                             |
| `GITHUB_APP_PRIVATE_KEY_BASE64` | Base64-encoded private key PEM, without line wrapping      |
| `GITHUB_WEBHOOK_SECRET`         | Random secret shared with the GitHub webhook configuration |

GitHub is optional at startup and required to add Sources. Configure all required values together; partial configuration is rejected. Follow the [GitHub setup guide](/docs/integrations/github) for permissions and webhook URLs.

## Notification providers

Provider credentials are installation settings. Delivery destinations and event categories are configured per Source. See [Notifications](/docs/integrations/notifications) for the complete setup and delivery checks.

### Slack

Set `TOWBAR_SLACK_BOT_TOKEN` to the bot token for your Slack app, then recreate the API container. Invite the bot to each destination channel.

### Email (SMTP)

| Variable                     | Default  | Purpose                 |
| ---------------------------- | -------- | ----------------------- |
| `TOWBAR_SMTP_HOST`           | Required | SMTP server hostname    |
| `TOWBAR_SMTP_FROM`           | Required | Sender address          |
| `TOWBAR_SMTP_PORT`           | `587`    | SMTP port               |
| `TOWBAR_SMTP_SECURE`         | `false`  | Use implicit TLS        |
| `TOWBAR_SMTP_USERNAME`       | Unset    | Authentication username |
| `TOWBAR_SMTP_PASSWORD`       | Unset    | Authentication password |
| `TOWBAR_SMTP_SUBJECT_PREFIX` | `Towbar` | Email subject prefix    |

Set username and password together when the server requires authentication. Match the port and TLS mode to your provider. Recreate the API after changing provider values:

```bash
docker compose up --detach --force-recreate api
```

## Image vulnerability scanning

Set `TOWBAR_VULNERABILITY_SCANNING_ENABLED=true` to make image scanning
available to Sources. Each App must then opt in explicitly in its deployment
manifest:

```yaml
apps:
  - id: hello-towbar
    vulnerabilityScanning: true
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
docker compose up --detach --force-recreate api worker
```

## Owner recovery

Initial owner setup happens in the dashboard on an empty installation. For later recovery, `TOWBAR_OWNER_RESET_EMAIL` and `TOWBAR_OWNER_RESET_PASSWORD` must be set together. Follow the [recovery procedure](/docs/self-hosting/upgrades#forgotten-owner-password), then remove both variables.

## Servers and worker capacity

Register IP addresses, SSH access, concurrency, and Cloudflare credentials under [Servers](/docs/servers). These settings do not belong in the manifest. [AWS credentials](/docs/integrations/aws) are an optional workspace integration for S3 operations.

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

## Release automation

The optional GitHub Actions deployment environment is documented under [Upgrades and recovery](/docs/self-hosting/upgrades#automatic-release-deployment).
