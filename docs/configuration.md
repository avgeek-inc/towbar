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
- Checks: read and write (required for deployment-plan reporting)
- Pull requests: read and write (required for Preview deployments and their PR status comment)
- Deployments: read and write (required for Preview deployment statuses)
- Webhook events: push, pull request, and installation
- Webhook URL: `${TOWBAR_API_BASE_URL}/v1/public/webhooks/github`
- Setup URL with redirect enabled:
  `${TOWBAR_APP_BASE_URL}/settings?section=github`

Existing installations must approve the Checks and Pull requests permission
upgrades before Towbar can publish deployment-plan Checks or update the Preview
status comment.

Encode the downloaded PEM without line wrapping:

```bash
base64 < github-app.pem | tr -d '\n'
```

Store the result in `GITHUB_APP_PRIVATE_KEY_BASE64`. Set `GITHUB_APP_ID`,
`GITHUB_APP_SLUG`, and a randomly generated `GITHUB_WEBHOOK_SECRET` as well.
Towbar rejects partially configured GitHub App credentials.

## Notification providers

Notification provider credentials belong to the Towbar installation. They are
never stored on a Source or resolved through the Source's AWS credentials.
After a provider is configured, each Source can opt in by supplying only its
delivery target under **Source → Settings → Notifications**.

### Slack

Create a Slack app with a bot token that has `chat:write`, install it in the
workspace, and set `TOWBAR_SLACK_BOT_TOKEN`. Invite the bot to each channel that
should receive notifications. A Source then stores only that channel's ID,
such as `C0123456789`.

### Email

Set `TOWBAR_SMTP_HOST` and `TOWBAR_SMTP_FROM` to enable email notifications.
`TOWBAR_SMTP_PORT` defaults to `587`, `TOWBAR_SMTP_SECURE` defaults to `false`,
and `TOWBAR_SMTP_SUBJECT_PREFIX` defaults to `Towbar`. If the server requires
authentication, set both `TOWBAR_SMTP_USERNAME` and `TOWBAR_SMTP_PASSWORD`; the
API rejects a partial pair. A Source stores only its recipient email addresses.

Recreate the API container after changing provider variables:

```bash
docker compose up --detach --force-recreate api
```

## Image vulnerability scanning

Set `TOWBAR_VULNERABILITY_SCANNING_ENABLED=true` to queue an optional scan of
the immutable image digest after each successful deployment. Towbar reuses one
result per workspace and image digest, stores only bounded normalized findings,
and keeps scan failures separate from deployment health. The deployment detail
page shows severity totals, actionable findings, scanner metadata, and stale or
failed states.

`TOWBAR_VULNERABILITY_SCAN_MAX_AGE_HOURS` controls when completed results are
labelled stale and defaults to `168` hours. `TOWBAR_TRIVY_IMAGE` configures the
worker-side scanner and must pin both a Trivy tag and image digest. The shipped
default is a reviewed multi-architecture pin. Recreate both the API and worker
after changing scanner configuration:

```bash
docker compose up --detach --force-recreate api worker
```

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

`TOWBAR_WORKER_MAX_CONCURRENT_ACTIVITIES` defaults to `4` and limits activity
execution across every Source. Keep it above the largest server
`buildConcurrency` value with capacity left for Source sync and maintenance.
Each destination server still enforces its own manifest limit.

The App and Resource **Secrets** tabs can add, replace, or remove individual
JSON environment keys behind an attached reference. Listings expose only key
names and version metadata. The owner can explicitly reveal current values
through a no-store response while editing them. Towbar performs the merge in
the API, checks the expected AWS version before writing, and does not persist
secret values in PostgreSQL or logs. Shared references show every affected App
or Resource before an operator edits them. This flow requires narrowly scoped
`secretsmanager:DescribeSecret`, `secretsmanager:GetSecretValue`, and
`secretsmanager:PutSecretValue` permissions; changing the reference itself
still requires a manifest commit and Source sync.

The current deployment schema is served by the configured website at
`${TOWBAR_WEBSITE_BASE_URL}/schemas/deployment.v1.json` and documented under
`${TOWBAR_WEBSITE_BASE_URL}/docs/deployment-file`.

## Deployment plans

Source **Plans** are side-effect-free comparisons between an immutable
candidate commit and the Source's currently materialized inventory. Generating
a manual plan fetches the configured branch but does not sync, archive, deploy,
resolve secret values, or change a server. The plan stores the current and
target manifest digests, then classifies every App, Resource, and Server as
create, update, archive, restore, or no-op.

Validation covers manifest schema, domain ownership, Source branch alignment,
server preparation and observed capacity, declared secret references by name,
and conflicting active operations. Secret bindings are checked with
`secretsmanager:DescribeSecret`; secret values are never fetched for a plan.
A failed validation marks the plan **Blocked** and includes an actionable
message; warnings remain visible without blocking the comparison.

For a same-repository pull request targeting the Source branch, Towbar creates
the same comparison against the PR head commit and publishes one completed
`Towbar deployment plan` Check Run for that commit. App rows respect
`autoDeploy.inputs`; unrelated paths do not create irrelevant plan rows. The
Check links to the immutable plan detail page. Repeated webhook deliveries
update the existing Check instead of creating another one. Plan generation is
observational and never gates or orders Preview or production deployments.

## Preview deployments

Preview deployments are opt-in per App. Opening a same-repository pull request
that targets `source.branch` builds its immutable head commit and promotes it
to one stable PR URL. Draft pull requests are supported. Resources are not
cloned, and production shared or App secrets are never inherited.

```yaml
servers:
  - ip: 203.0.113.10
    buildConcurrency: 4
    previewBuildConcurrency: 1
    ssh:
      username: deploy
    secrets:
      login: aws:example/production/server-login

apps:
  - id: hello-towbar
    # Existing production configuration omitted.
    preview:
      enabled: true
      domain: preview.example.com
      ttlHours: 72
      secrets:
        build: aws:example/preview/hello-build
        deployment: aws:example/preview/hello-runtime
        hooks:
          preDeploy: aws:example/preview/hello-migrations
```

The generated hostname includes the App ID, pull request number, and a stable
Source/PR hash, for example
`hello-towbar-pr-42-a1b2c3d4.preview.example.com`. With
`tls.mode: cloudflare-dns`, Towbar creates and removes the exact proxied DNS
record. With `tls.mode: direct`, route the Preview base domain to the target
server yourself, normally through wildcard DNS. If Cloudflare proxies a nested
Preview wildcard, confirm that the zone's certificate covers that hostname;
DNS wildcard support does not by itself extend Universal SSL certificate
coverage to every nested level.

`previewBuildConcurrency` defaults to `1`, cannot exceed `buildConcurrency`,
and is capped at `4`. Preview builds have lower queue priority than production,
Resource, cleanup, and server operations. A newer PR commit supersedes only
queued work for that App and PR. A failed build leaves the last healthy Preview
live. Merging or closing the pull request, retargeting it away from
`source.branch`, disabling Preview in the next successful Source sync,
manually deleting it in Towbar, or reaching `ttlHours` queues targeted
container, image, route, and DNS cleanup; persistent volumes and Resources are
never removed. Reopening an eligible pull request recreates its Preview.

Towbar reconciles `opened`, `reopened`, `synchronize`, `edited`, and `closed`
webhooks against the pull request's current GitHub state. This makes duplicate,
delayed, and out-of-order deliveries safe and keeps branch renames under the
same PR identity. Pull requests from forks and pull requests targeting another
base branch are not deployed. When an App configures `autoDeploy.inputs`,
Preview admission uses those same expanded path patterns against the pull
request's complete changed-file list. An unrelated pull request does not create
a Preview, and reverting all matching changes cleans up an existing Preview.
An incomplete GitHub changed-file response remains eligible rather than risking
a false skip. Apps using plain `autoDeploy: true` remain commit-sensitive and
Preview every eligible pull request. A successful `Sync now` also reconciles
open eligible pull requests and existing Preview environments, so enabling
Preview after a PR opens or recovering a missed webhook does not require a new
commit.
Towbar also maintains one comment per Source and pull request with every App's
build status, Preview URL, and deployment details link. A hidden stable marker
lets Towbar update the same GitHub comment instead of posting a new comment for
each state change.

Treat Preview pull requests as executable deployment input. Use separate,
least-privilege Preview secret references with disposable or non-production
credentials. Production branch, target server, domains, Resource
configuration, and secrets remain controlled only by the production manifest.

## Automatic release deployment

The `Deploy release` GitHub workflow deploys each stable published release to
one existing Towbar installation. It assumes an AWS role through GitHub OIDC
and runs the release script on the host through Systems Manager; no AWS access
key or SSH private key is stored in GitHub.

Configure these variables on a GitHub environment named `production`:

| Variable                       | Purpose                                      |
| ------------------------------ | -------------------------------------------- |
| `TOWBAR_DEPLOY_AWS_ROLE_ARN`   | OIDC role assumed by the release workflow    |
| `TOWBAR_DEPLOY_AWS_REGION`     | Region containing the managed EC2 instance   |
| `TOWBAR_DEPLOY_INSTANCE_ID`    | Only instance the role may command           |
| `TOWBAR_DEPLOY_PATH`           | Existing checkout; defaults to `/opt/towbar` |
| `TOWBAR_DEPLOY_API_HEALTH_URL` | Optional public API health endpoint          |
| `TOWBAR_DEPLOY_APP_HEALTH_URL` | Optional public app health endpoint          |

Read the repository's OIDC subject prefix with
`gh api repos/<owner>/<repository>/actions/oidc/customization/sub --jq .sub_claim_prefix`,
then trust only `<returned-prefix>:environment:production` in the role's OIDC
policy. This supports GitHub's immutable repository-ID subject without using a
wildcard. Grant `ssm:SendCommand` only for `AWS-RunShellScript` and the target
instance, plus `ssm:GetCommandInvocation` for reporting the result. The
instance must be online in Systems Manager and the deployment directory must
contain a clean Git checkout plus an owner-readable-only `.env` file.
Restrict the environment's deployment branches and tags to the protected
default branch and stable release tags.

The workflow verifies the published tag and package version, streams the
protected default branch's `infra/deploy-release.sh` to SSM, checks out the
exact release commit on the host, builds it there, runs migrations, waits for
Compose health, and verifies the running API commit. A failed replacement
attempts to restore the previous checkout and images.
