---
title: "GitHub"
description: "Connect repositories, receive push events, and publish pull request preview status."
---

Towbar uses a GitHub App to read your repositories and receive deployment events. You create the App for your installation and choose which repositories it can access.

## Before you begin

Install Towbar and configure reachable HTTPS app and API origins. You need permission to create a GitHub App and install it for the target account or organization.

## Create and install the App

Create one GitHub App for this Towbar installation:

- Repository contents: read-only
- Repository metadata: read-only
- Pull requests: read and write (required for Preview deployments and their PR status comment)
- Deployments: read and write (required when using Preview deployments)
- Webhook events: `push`, `pull_request`, and `installation`
- Webhook URL: `${TOWBAR_API_BASE_URL}/v1/public/webhooks/github`
- Setup URL with redirect enabled:
  `${TOWBAR_APP_BASE_URL}/manage/integrations?integration=github`

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

In Towbar, open **Manage → Integrations → Source control → GitHub**, install the App, and grant it access only
to repositories Towbar should deploy.

## Verify access

Open **Manage → System health** and choose **Run checks**. GitHub appears in the **Integrations** section. A healthy result verifies the connected installation; it does not mean a Source has synced or an app has deployed.

Open **Sources → Add source** and confirm the intended repository is available. If it is missing, review the GitHub App installation's repository selection and organization approval.

<div className="towbar-doc-screenshot">
  <div className="towbar-product-light">
    <img src="/assets/guides/github-light.webp" alt="Example GitHub connection. A preview-reporting warning can appear while the installation remains connected." width="2400" height="1136" loading="lazy" />
  </div>
  <div className="towbar-product-dark">
    <img src="/assets/guides/github-dark.webp" alt="Example GitHub connection. A preview-reporting warning can appear while the installation remains connected." width="2400" height="1136" loading="lazy" />
  </div>
  <p>Example GitHub connection. A preview-reporting warning can appear while the installation remains connected.</p>
</div>

## Maintain the connection

After changing App permissions, approve the updated installation in GitHub. Preview comments and statuses require their respective write permissions. If a webhook does not reach Towbar, inspect its delivery in GitHub and check the API origin, webhook path, and matching webhook secret.

Next, [add a Source](/docs/sources) or configure [preview environments](/docs/previews).
