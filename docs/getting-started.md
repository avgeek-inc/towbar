# Getting started

This guide follows the complete path from evaluating Towbar to completing a
first deployment.

```mermaid
flowchart TD
  evaluate[Confirm Towbar fits the environment] --> control[Install the control plane]
  control --> github[Create and connect a GitHub App]
  github --> target[Create a fresh Ubuntu target server]
  target --> manifest[Commit .towbar/deployment.yml]
  manifest --> source[Add and sync the Source]
  source --> trust[Verify the SSH host key]
  trust --> prepare[Prepare the server]
  prepare --> release[Deploy the app]
```

## 1. Confirm the fit

Towbar version 1 is intentionally narrow. It fits an operator who has:

- a Linux host for the Towbar control plane;
- one or more maintained Ubuntu deployment servers;
- GitHub repositories containing Dockerfiles;
- an AWS account for Source-scoped Secrets Manager values; and
- authority to create and install a GitHub App.

Towbar treats the configured Git branch as deployment truth. It does not offer
public sign-up, build arbitrary untrusted pull requests, publish a container
registry, or restore databases automatically. Read
[the architecture guide](architecture.md) and [SECURITY.md](../SECURITY.md)
before exposing an installation to the internet.

## 2. Install the control plane

Install Docker Engine with Compose v2, Git, and OpenSSL on the control-plane
host. Clone Towbar and create the local environment file:

```bash
git clone https://github.com/avgeek-inc/towbar.git
cd towbar
cp .env.example .env
```

Generate each PostgreSQL password and the HMAC secret independently:

```bash
openssl rand -hex 32
```

Generate the credential-encryption key separately. It must decode to exactly 32
bytes:

```bash
openssl rand -base64 32 | tr -d '\n'
```

Put those values in `.env`. For an internet reachable installation, also
replace the three base URLs before building. The API and web app need reachable
HTTPS origins; login stays on the web app origin. `TOWBAR_WEBSITE_BASE_URL` is
an external link target; Towbar does not run the website in this repository.

Start the stack:

```bash
docker compose up --build --detach --wait
docker compose ps
```

Open `TOWBAR_APP_BASE_URL`; with the default local configuration it is
`http://localhost:4021`. Towbar sends the first visitor to `/login` and a
one-time setup form for the owner name, email, and password. The API serializes
that creation and locks setup permanently after the first account exists.
Complete setup while the services are still loopback-bound, before enabling
public ingress.

If the owner password is later forgotten, use the environment-and-restart
procedure in [Configuration](configuration.md#forgotten-owner-password).
Towbar has no browser-accessible password-reset flow.

The loopback defaults are suitable for evaluating the UI on the host. GitHub
webhooks require the API URL to be reachable over HTTPS, so a complete
push-to-deploy setup also needs a maintained reverse proxy or private ingress.

## 3. Create the GitHub App

Create one GitHub App for this Towbar installation:

- Repository contents: read-only
- Repository metadata: read-only
- Deployments: read and write (required when using Preview deployments)
- Webhook events: `push` and `installation`
- Webhook URL: `${TOWBAR_API_BASE_URL}/v1/public/webhooks/github`
- Setup URL with redirect enabled:
  `${TOWBAR_APP_BASE_URL}/settings?section=github`

Generate a private key for the App and encode its PEM without line wrapping:

```bash
base64 < github-app.pem | tr -d '\n'
```

Set `GITHUB_APP_ID`, `GITHUB_APP_SLUG`,
`GITHUB_APP_PRIVATE_KEY_BASE64`, and a random `GITHUB_WEBHOOK_SECRET` in `.env`,
then recreate the API container:

```bash
docker compose up --detach --force-recreate api
```

In Towbar, open **Settings → GitHub**, install the App, and grant it access only
to repositories Towbar should deploy.

## 4. Create a target server

Use a fresh, dedicated Ubuntu 22.04 or 24.04 LTS server when possible. Give the
configured SSH user either root access or passwordless `sudo`; Towbar needs
that access to install and manage the deployment runtime. Restrict SSH at the
network layer and do not reuse this account for untrusted interactive users.

The **Prepare Server** action installs or validates:

- Docker Engine 28 or newer;
- Caddy running as a systemd service;
- `python3` and GNU `timeout`;
- at least 1 GiB available under Docker's data directory; and
- an SSH user that can run Docker and the required Caddy operations with
  non-interactive `sudo`.

Towbar follows the upstream
[Docker Engine](https://docs.docker.com/engine/install/ubuntu/) and
[Caddy](https://caddyserver.com/docs/install) package repositories. Caddy's
standard package is enough for `tls.mode: direct`; `tls.mode: cloudflare-dns`
uses a pinned custom build containing the `dns.providers.cloudflare` module.
Compatible installations are reused. Towbar does not remove conflicting
packages or overwrite an unmanaged Caddy binary: it stops at the failing step,
shows the reason, and asks the operator to clean the server before retrying.

Treat Docker access as root-equivalent.

Store the SSH private key in AWS Secrets Manager as a JSON object:

```json
{
  "privateKey": "-----BEGIN OPENSSH PRIVATE KEY-----\n..."
}
```

The Source's AWS identity needs `sts:GetCallerIdentity` and
`secretsmanager:GetSecretValue` only for the secret paths declared by that
Source. To edit App environment bundles from the App's **Secrets** tab, also
grant `secretsmanager:PutSecretValue` only on those specific build, deployment,
and hook secret ARNs. Server login and Cloudflare credentials do not need write
permission. Add narrowly scoped S3 permissions only when using managed backups.

## 5. Add the deployment manifest

Copy [the starter manifest](../examples/deployment.yml) into the repository to
deploy:

```bash
mkdir -p .towbar
cp /path/to/towbar/examples/deployment.yml .towbar/deployment.yml
```

Replace the example IP, SSH username, AWS secret reference, domain, Dockerfile,
port, and input globs. Commit the file to the branch declared in
`source.branch`. The starter file is parsed by Towbar's test suite so it cannot
silently drift away from the published schema.

## 6. Add, verify, and prepare the Source

In the dashboard:

1. Open **Sources → Add source** and select the installed repository.
2. Let Towbar import `.towbar/deployment.yml`.
3. Open **Source → Settings → AWS credentials** and store the Source's scoped
   access key, secret access key, and default region.
4. Open **Source → Servers**, select the imported server, and choose
   **Check server**.
5. Compare the discovered SSH fingerprint with the server console or cloud
   provider through an independent channel. Trust it only after it matches.
6. Open the Server's **Overview** tab and choose **Prepare Server**.
7. Follow the durable preparation steps until the Server is `Ready`. Apps and
   Resources remain `Server Setup Pending` and cannot deploy before this point.

App secret references remain manifest-owned. On an App's **Secrets** tab,
Towbar initially returns only key names and version metadata. The owner can
explicitly reveal the current values through a no-store API response while
editing them; Towbar does not persist those values in PostgreSQL or logs. Saves
are merged into the referenced AWS JSON object server-side. **Save and deploy**
explicitly queues a deployment because a Secrets Manager version change does
not create a Git commit.

If preparation stops on an existing server, use the reported step and command
failure to remove only the conflicting installation, then retry. A fresh
server is the recommended recovery when ownership of the existing services is
unclear.

## 7. Make the first deployment

Open **Source → Apps**, select the imported app, and choose **Deploy**. Towbar
queues the operation, fetches the immutable Git commit, transfers the selected
build context, builds on the target, checks health, configures Caddy, and
promotes the candidate.

A working installation has all of the following:

- `docker compose ps` reports the Towbar services healthy;
- the Source's latest sync is `Succeeded`;
- the target Server is `Ready`;
- the deployment reaches `Succeeded`; and
- the configured domain serves the expected commit over HTTPS.

After the manual deployment succeeds, push a change matching
`autoDeploy.inputs`. The GitHub delivery, Source sync, and deployment should
appear independently in Towbar; a successful sync alone does not imply a
successful deployment.

## Useful diagnostics

```bash
docker compose ps
docker compose logs --follow api worker
docker compose logs --tail 200 temporal
```

See [configuration](configuration.md) for every installation variable. If an
issue may expose credentials or cross a trust boundary, follow
[the private reporting process](../SECURITY.md) instead of posting logs to a
public issue.
