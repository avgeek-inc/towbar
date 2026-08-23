# Configuration

Copy `.env.example` to `.env`. Compose reads the file from the repository root.
Do not commit `.env`.

## Required installation secrets

| Variable                           | Purpose                                 |
| ---------------------------------- | --------------------------------------- |
| `TOWBAR_POSTGRES_PASSWORD`         | PostgreSQL owner and migration password |
| `TOWBAR_DATABASE_RUNTIME_PASSWORD` | Restricted API database password        |
| `TOWBAR_CREDENTIALS_KEY`           | Encrypts stored Source AWS credentials  |
| `TOWBAR_INTERNAL_HMAC_SECRET`      | Signs API and worker internal requests  |

Generate every value independently. Hex output from `openssl rand -hex 32` is
URL-safe for the Compose database URLs.

## Public origins

Set all four base URLs before building images. Browser bundles embed public
URLs at build time. The website URL is an external navigation target; this
repository does not run the marketing or documentation website.

| Variable                  | Example                      |
| ------------------------- | ---------------------------- |
| `TOWBAR_API_BASE_URL`     | `https://api.towbar.example` |
| `TOWBAR_APP_BASE_URL`     | `https://app.towbar.example` |
| `TOWBAR_SSO_BASE_URL`     | `https://sso.towbar.example` |
| `TOWBAR_WEBSITE_BASE_URL` | `https://towbar.example`     |

The default `TOWBAR_BIND_ADDRESS=127.0.0.1` keeps services private to the host.
Terminate TLS at a reverse proxy on that host or a private load balancer.

## GitHub App

GitHub connectivity is optional for the initial stack start and required to add
a Source. Configure a GitHub App with:

- Repository contents: read-only
- Repository metadata: read-only
- Webhook events: push and installation
- Webhook URL: `${TOWBAR_API_BASE_URL}/v1/public/webhooks/github`
- Setup URL with redirect enabled:
  `${TOWBAR_APP_BASE_URL}/settings?section=github`

Encode the downloaded PEM without line wrapping:

```bash
base64 < github-app.pem | tr -d '\n'
```

Store the result in `GITHUB_APP_PRIVATE_KEY_BASE64`. Set `GITHUB_APP_ID`,
`GITHUB_APP_SLUG`, and a randomly generated `GITHUB_WEBHOOK_SECRET` as well.
Towbar rejects partially configured GitHub App credentials.

## Bootstrap account

`TOWBAR_BOOTSTRAP_*` values are consumed only by the explicit bootstrap profile:

```bash
docker compose --profile bootstrap run --rm bootstrap
```

Use a strong, unique password and remove bootstrap values from `.env` after the
account exists if you do not need to rerun the command.

## Deployment targets and Source credentials

Destination servers are manifest configuration, not installation environment
variables. Add a Source, store its scoped AWS credential through the dashboard,
and declare servers and deployables in `.towbar/deployment.yml`. Secret values
remain in AWS Secrets Manager; the manifest stores provider references only.

The current deployment schema is served by the configured website at
`${TOWBAR_WEBSITE_BASE_URL}/schemas/deployment.v1.json` and documented under
`${TOWBAR_WEBSITE_BASE_URL}/docs/deployment-file`.
