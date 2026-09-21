---
title: "Deploy with GitHub Actions"
description: "Deploy an exact Towbar release to a Linux server over SSH or AWS Systems Manager."
---

Towbar includes a `Deploy release` workflow for repeatable control-plane upgrades. The simplest setup uses SSH from a GitHub-hosted runner to an existing Linux server. AWS installations can use Systems Manager instead, without storing an SSH key in GitHub. AWS installations can also bootstrap an empty Ubuntu or Debian VM and manage its complete runtime environment without an interactive server login.

The workflows deploy only stable published releases. A manual run also requires an existing published tag. They verify that the tag's `package.json` version matches the tag, check out the exact release commit on the server, build the API, worker, and dashboard, apply migrations, wait for Compose health checks, and verify the commit reported by the API. Deployments are serialized with a host lock. A failed replacement restores the previous checkout and Compose images.

## Manage the runtime environment from GitHub

For an AWS Systems Manager installation, the `production` environment can contain one GitHub Actions secret named `TOWBAR_RUNTIME_ENV`. Its value is the complete contents of the production `.env` file. On every bootstrap or release deployment, the workflow writes that value to AWS Secrets Manager over TLS. The VM retrieves it with its instance role and atomically replaces `/opt/towbar/.env` with mode `600` before Compose validation and startup. The plaintext is not included in an SSM command or workflow output.

Keep the canonical file in a password manager or another encrypted operator store. GitHub intentionally does not reveal a secret after it is saved. Replace the complete secret whenever any runtime value changes:

```bash
gh secret set TOWBAR_RUNTIME_ENV --env production <.env.production
```

The latest deployed value also remains encrypted in AWS Secrets Manager. An authorized operator can recover it without logging in to the VM:

```bash
umask 077
aws secretsmanager get-secret-value \
  --secret-id towbar/production/runtime-env \
  --query SecretString \
  --output text >.env.production
```

Rerun **Deploy release** with the currently published tag to apply an environment-only change. This rebuilds and replaces the services using the same release commit and the new environment. Changing `TOWBAR_CREDENTIALS_KEY` makes existing encrypted records unreadable, and changing database passwords does not rotate credentials inside an existing PostgreSQL volume. Treat those values as persistent installation identity rather than routine settings.

The workflow uses `towbar/production/runtime-env` as the AWS secret name by default. Set `TOWBAR_RUNTIME_ENV_SECRET_ID` in the GitHub `production` environment to use another name or an existing secret ARN. The GitHub OIDC role needs `secretsmanager:DescribeSecret`, `secretsmanager:CreateSecret`, and `secretsmanager:PutSecretValue` for that secret. The EC2 instance role needs only `secretsmanager:GetSecretValue`. Scope both roles to the ARN for the production secret name, including Secrets Manager's generated ARN suffix.

## Prepare the server once

Install Docker Engine with Compose v2, Git, OpenSSL, an SSH server, GNU `base64`, and `flock` from util-linux. Ubuntu includes the last two utilities by default. Use a dedicated server or VM and a dedicated SSH key. The SSH account needs non-interactive `sudo` because a deployment manages system-owned containers and the checkout while preserving the checkout's ordinary owner.

Create the installation directory as the SSH account, clone Towbar, and create the host-managed environment file:

```bash
sudo install -d -m 0755 -o "$USER" -g "$USER" /opt/towbar
git clone https://github.com/avgeek-inc/towbar.git /opt/towbar
cd /opt/towbar
cp .env.example .env
chmod 600 .env
```

Fill `.env` using the [installation guide](/docs/self-hosting/installation), then verify the prerequisites without starting an unreviewed checkout:

```bash
docker compose --env-file .env config --quiet
sudo --non-interactive true
git status --short
```

The final command must be empty. The workflow rejects tracked changes instead of overwriting host edits. Keep `.env` on the server; it is ignored by Git. If `TOWBAR_RUNTIME_ENV` is not configured, the release workflow preserves this host-managed file.

## Create the deployment key

Generate a dedicated Ed25519 key on a trusted workstation. Do not reuse a personal key:

```bash
ssh-keygen -t ed25519 -C towbar-github-actions -f towbar-deploy
```

Add `towbar-deploy.pub` to the server account's `~/.ssh/authorized_keys`. Store the complete private key as the `TOWBAR_DEPLOY_SSH_PRIVATE_KEY` secret in a GitHub environment named `production`.

## Configure the production environment

Create a GitHub environment named `production`, require approval if more than one person can publish releases, and restrict it to the protected default branch and stable release tags.

Add these environment variables:

| Variable                       | Value or purpose                               |
| ------------------------------ | ---------------------------------------------- |
| `TOWBAR_DEPLOY_ENABLED`        | `true` to deploy stable releases automatically |
| `TOWBAR_DEPLOY_TRANSPORT`      | `ssh`                                          |
| `TOWBAR_DEPLOY_SSH_USER`       | SSH account; defaults to `ubuntu`              |
| `TOWBAR_DEPLOY_SSH_PORT`       | SSH port; defaults to `22`                     |
| `TOWBAR_DEPLOY_PATH`           | Existing checkout; defaults to `/opt/towbar`   |
| `TOWBAR_DEPLOY_API_HEALTH_URL` | Optional public API `/health` URL              |
| `TOWBAR_DEPLOY_APP_HEALTH_URL` | Optional public dashboard URL                  |

Add these environment secrets:

| Secret                          | Purpose                        |
| ------------------------------- | ------------------------------ |
| `TOWBAR_DEPLOY_SSH_HOST`        | Server DNS name or IP address  |
| `TOWBAR_DEPLOY_SSH_PRIVATE_KEY` | Complete dedicated private key |

GitHub-hosted runners start with an empty SSH profile. The workflow accepts the host key presented during each run, so no `known_hosts` secret is required.

The deployment key can initiate a root-level release through `sudo`; protect the environment, restrict who can modify the workflow and default branch, and rotate the key after suspected exposure.

## Run the first deployment

Publish a stable release such as `v2.0.0`, or select **Actions → Deploy release → Run workflow** and enter an existing stable published tag. Stable releases deploy automatically when `TOWBAR_DEPLOY_ENABLED` is `true`. Manual runs remain available without that variable, which lets you test the deployment before enabling automatic releases.

Review the workflow summary and then verify:

```bash
cd /opt/towbar
sudo docker compose --env-file .env ps
sudo docker compose --env-file .env logs --tail 200 migrate api worker
```

Complete initial account setup using the one-time setup link from the [installation guide](/docs/self-hosting/installation). A successful workflow proves that the selected release is running; continue with the public ingress, provider, SMTP, backup, and recovery checks required by your installation.

## Use AWS Systems Manager instead

Set `TOWBAR_DEPLOY_TRANSPORT=aws-ssm` or omit it for the default AWS transport. Configure these `production` environment variables:

| Variable                       | Purpose                                                 |
| ------------------------------ | ------------------------------------------------------- |
| `TOWBAR_DEPLOY_ENABLED`        | `true` to deploy stable releases automatically          |
| `TOWBAR_DEPLOY_AWS_ROLE_ARN`   | GitHub OIDC role assumed by the workflow                |
| `TOWBAR_DEPLOY_AWS_REGION`     | Region containing the managed EC2 instance              |
| `TOWBAR_DEPLOY_INSTANCE_ID`    | Only instance the role may command                      |
| `TOWBAR_DEPLOY_PATH`           | Existing checkout; defaults to `/opt/towbar`            |
| `TOWBAR_DEPLOY_OWNER`          | Bootstrap checkout owner; defaults to `towbar`          |
| `TOWBAR_DEPLOY_API_HEALTH_URL` | Optional public API `/health` URL                       |
| `TOWBAR_DEPLOY_APP_HEALTH_URL` | Optional public dashboard URL                           |
| `TOWBAR_RUNTIME_ENV_SECRET_ID` | AWS secret; defaults to `towbar/production/runtime-env` |

Read the repository's OIDC subject prefix with:

```bash
gh api repos/<owner>/<repository>/actions/oidc/customization/sub --jq .sub_claim_prefix
```

Trust only `<returned-prefix>:environment:production` in the AWS role. Grant `ssm:SendCommand` only for `AWS-RunShellScript` and the target instance, plus `ssm:GetCommandInvocation` for reporting. When `TOWBAR_RUNTIME_ENV` is configured, also grant the Secrets Manager permissions described above. The instance must be online in Systems Manager and its instance role must be able to read the runtime environment secret.

### Bootstrap without logging in to the VM

Create the `production` environment variables above and save the complete `.env` as its `TOWBAR_RUNTIME_ENV` secret. The VM needs SSM Agent, a Systems Manager instance profile, and outbound HTTPS access. No SSH listener or deployment key is required.

Select **Actions → Bootstrap release → Run workflow** and enter an existing stable published tag. The workflow:

1. Copies the GitHub environment secret into the encrypted AWS Secrets Manager handoff.
2. Uses SSM Run Command to install Docker Engine, Compose v2, Git, OpenSSL, and the AWS CLI on a supported Ubuntu or Debian host.
3. Creates the unprivileged deployment owner and `/opt/towbar` checkout.
4. Retrieves `.env` through the VM's instance role and installs the exact release.
5. Runs the same health and exact-commit checks as later release deployments.

Use **Deploy release** for every later code or environment update. It refreshes `.env` from the GitHub secret before restarting Towbar. Bootstrap marks a successful installation and refuses to run over it, which prevents accidental host reprovisioning.

## Troubleshoot a failed deployment

- A tag validation failure means the release is missing, draft, prerelease, or does not match the package version.
- A dirty-checkout error protects host changes from being overwritten. Move the change into a reviewed commit or restore the checkout.
- A missing `.env` or permissive file mode must be fixed on the host. Use mode `600` or `400`.
- A Secrets Manager failure means the GitHub OIDC role could not update the configured secret, or the VM instance role could not read it.
- A Compose health failure triggers rollback. Inspect the workflow output and the host's `migrate`, `api`, and `worker` logs before retrying.

The deployment script does not back up PostgreSQL. Follow the [upgrade checklist](/docs/self-hosting/upgrades) before publishing or manually dispatching an upgrade.
