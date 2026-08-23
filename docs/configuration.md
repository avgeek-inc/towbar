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

Generate the PostgreSQL passwords and HMAC secret independently with
`openssl rand -hex 32`. Hex output is URL-safe for the Compose database URLs.
`TOWBAR_CREDENTIALS_KEY` must instead be a separate 32-byte Base64 value from
`openssl rand -base64 32 | tr -d '\n'`; Towbar rejects any other decoded key
length.

## Public origins

Set all three base URLs before building images. Browser bundles embed public
URLs at build time. The website URL is an external navigation target; this
repository does not run the marketing or documentation website.

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

## Initial owner

Towbar does not accept initial owner credentials through environment variables.
On an empty database, the web app's `/login` page presents a one-time owner
setup form. The first successful submission creates the owner atomically and
permanently locks account creation. Keep the default loopback binding until
this step is complete.

## Forgotten owner password

Towbar deliberately exposes no public forgot-password or reset-password route.
Recovery is an explicit control-plane restart operation:

1. Generate a high-entropy temporary password with `openssl rand -base64 32`.
2. Set `TOWBAR_OWNER_RESET_EMAIL` to the existing owner email and
   `TOWBAR_OWNER_RESET_PASSWORD` to that temporary value in `.env`.
3. Run `docker compose up --detach --force-recreate api`.
4. Sign in at `${TOWBAR_APP_BASE_URL}/login` with the temporary password.
5. Change the password under **Settings → Account**.
6. Remove both reset variables and recreate the API container again.

The API fails fast if only one variable is set, if the email is not an enabled
owner, or if the temporary password is shorter than 20 characters. Applying a
reset revokes every existing session. PostgreSQL stores only an HMAC
fingerprint, so an unchanged reset value is not reapplied on a later restart.
The temporary password remains visible to the host/container administrator
while configured, which is why it must be random, short-lived, and removed.

## Deployment targets and Source credentials

Destination servers are manifest configuration, not installation environment
variables. Add a Source, store its scoped AWS credential through the dashboard,
and declare servers and deployables in `.towbar/deployment.yml`. Secret values
remain in AWS Secrets Manager; the manifest stores provider references only.

The current deployment schema is served by the configured website at
`${TOWBAR_WEBSITE_BASE_URL}/schemas/deployment.v1.json` and documented under
`${TOWBAR_WEBSITE_BASE_URL}/docs/deployment-file`.
