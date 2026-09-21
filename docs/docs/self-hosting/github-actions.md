---
title: "Deploy with GitHub Actions"
description: "Deploy an exact Towbar release to a Linux server over SSH or AWS Systems Manager."
---

Towbar includes a `Deploy release` workflow for repeatable control-plane upgrades. The simplest setup uses SSH from a GitHub-hosted runner to an existing Linux server. AWS installations can use Systems Manager instead, without storing an SSH key in GitHub.

The workflow deploys only stable published releases. A manual run also requires an existing published tag. It verifies that the tag's `package.json` version matches the tag, checks out the exact release commit on the server, builds the API, worker, and dashboard, applies migrations, waits for Compose health checks, and verifies the commit reported by the API. Deployments are serialized with a host lock. A failed replacement restores the previous checkout and Compose images.

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

The final command must be empty. The workflow rejects tracked changes instead of overwriting host edits. Keep `.env` on the server; it is ignored by Git and is never copied into GitHub Actions.

## Create the deployment key

Generate a dedicated Ed25519 key on a trusted workstation. Do not reuse a personal key:

```bash
ssh-keygen -t ed25519 -C towbar-github-actions -f towbar-deploy
```

Add `towbar-deploy.pub` to the server account's `~/.ssh/authorized_keys`. Store the complete private key as the `TOWBAR_DEPLOY_SSH_PRIVATE_KEY` secret in a GitHub environment named `production`.

Record the server's SSH host key from a trusted network:

```bash
ssh-keyscan -H -p 22 towbar.example.com > towbar-known-hosts
ssh-keygen -lf towbar-known-hosts
```

Compare that fingerprint with the host fingerprint shown by the server console or provider before saving the complete `towbar-known-hosts` contents as `TOWBAR_DEPLOY_SSH_KNOWN_HOSTS`. The workflow uses strict host-key checking and never accepts a new key automatically.

## Configure the production environment

Create a GitHub environment named `production`, require approval if more than one person can publish releases, and restrict it to the protected default branch and stable release tags.

Add these environment variables:

| Variable                       | Value or purpose                             |
| ------------------------------ | -------------------------------------------- |
| `TOWBAR_DEPLOY_TRANSPORT`      | `ssh`                                        |
| `TOWBAR_DEPLOY_SSH_USER`       | SSH account; defaults to `ubuntu`            |
| `TOWBAR_DEPLOY_SSH_PORT`       | SSH port; defaults to `22`                   |
| `TOWBAR_DEPLOY_PATH`           | Existing checkout; defaults to `/opt/towbar` |
| `TOWBAR_DEPLOY_API_HEALTH_URL` | Optional public API `/health` URL            |
| `TOWBAR_DEPLOY_APP_HEALTH_URL` | Optional public dashboard URL                |

Add these environment secrets:

| Secret                          | Purpose                                       |
| ------------------------------- | --------------------------------------------- |
| `TOWBAR_DEPLOY_SSH_HOST`        | Server DNS name or IP address                 |
| `TOWBAR_DEPLOY_SSH_PRIVATE_KEY` | Complete dedicated private key                |
| `TOWBAR_DEPLOY_SSH_KNOWN_HOSTS` | Pinned `known_hosts` line for the destination |

The deployment key can initiate a root-level release through `sudo`; protect the environment, restrict who can modify the workflow and default branch, and rotate the key after suspected exposure.

## Run the first deployment

Publish a stable release such as `v2.0.0`, or select **Actions → Deploy release → Run workflow** and enter an existing stable published tag. The same workflow runs automatically for later stable releases.

Review the workflow summary and then verify:

```bash
cd /opt/towbar
sudo docker compose --env-file .env ps
sudo docker compose --env-file .env logs --tail 200 migrate api worker
```

Complete initial account setup using the one-time setup link from the [installation guide](/docs/self-hosting/installation). A successful workflow proves that the selected release is running; continue with the public ingress, provider, SMTP, backup, and recovery checks required by your installation.

## Use AWS Systems Manager instead

Set `TOWBAR_DEPLOY_TRANSPORT=aws-ssm` or omit it for the default AWS transport. Configure these `production` environment variables:

| Variable                       | Purpose                                      |
| ------------------------------ | -------------------------------------------- |
| `TOWBAR_DEPLOY_AWS_ROLE_ARN`   | GitHub OIDC role assumed by the workflow     |
| `TOWBAR_DEPLOY_AWS_REGION`     | Region containing the managed EC2 instance   |
| `TOWBAR_DEPLOY_INSTANCE_ID`    | Only instance the role may command           |
| `TOWBAR_DEPLOY_PATH`           | Existing checkout; defaults to `/opt/towbar` |
| `TOWBAR_DEPLOY_API_HEALTH_URL` | Optional public API `/health` URL            |
| `TOWBAR_DEPLOY_APP_HEALTH_URL` | Optional public dashboard URL                |

Read the repository's OIDC subject prefix with:

```bash
gh api repos/<owner>/<repository>/actions/oidc/customization/sub --jq .sub_claim_prefix
```

Trust only `<returned-prefix>:environment:production` in the AWS role. Grant `ssm:SendCommand` only for `AWS-RunShellScript` and the target instance, plus `ssm:GetCommandInvocation` for reporting. The instance must be online in Systems Manager.

## Troubleshoot a failed deployment

- A tag validation failure means the release is missing, draft, prerelease, or does not match the package version.
- A host-key error means the destination key differs from the pinned value. Verify the server through its console before replacing the secret.
- A dirty-checkout error protects host changes from being overwritten. Move the change into a reviewed commit or restore the checkout.
- A missing `.env` or permissive file mode must be fixed on the host. Use mode `600` or `400`.
- A Compose health failure triggers rollback. Inspect the workflow output and the host's `migrate`, `api`, and `worker` logs before retrying.

The deployment script does not back up PostgreSQL. Follow the [upgrade checklist](/docs/self-hosting/upgrades) before publishing or manually dispatching an upgrade.
