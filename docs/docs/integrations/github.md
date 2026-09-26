---
title: "GitHub"
description: "Configure a GitHub App in Towbar's YAML configuration, install it, and connect repositories."
icon: "/assets/integration-logos/github.svg"
---

<img className="towbar-doc-brand-logo" src="/assets/integration-logos/github.svg" alt="GitHub logo" aria-hidden="true" />

Towbar uses one GitHub App per installation. The App identity and private key live in `/etc/towbar/config.yml`. PostgreSQL stores the selected installation and account metadata, never the App private key or an optional webhook secret.

## Create and configure the App

1. Open **Settings → Developer settings → GitHub Apps**, then choose **New GitHub App**. You can also open [GitHub's new App form](https://github.com/settings/apps/new) directly.

   ![Find GitHub Apps in Developer settings.](/assets/guides/github-app/open-developer-settings.png)

   ![Create a new GitHub App.](/assets/guides/github-app/create-github-app.png)

2. Give the App a unique name and set its **Homepage URL** to your Towbar origin.

   ![Set the GitHub App name and homepage URL.](/assets/guides/github-app/app-name-and-homepage.png)

3. Set **Setup URL** to `https://towbar.example.com/manage/integrations/github` and enable **Redirect on update**. Keep the webhook active, set **Webhook URL** to `https://towbar.example.com/v1/public/webhooks/github`, and leave SSL verification enabled. Replace `towbar.example.com` in both URLs with your `installation.appUrl` origin. The webhook secret is optional. If you set one in GitHub, enter the same value as `integrations.github.webhookSecret` in Towbar.

   ![Set the GitHub App setup and webhook URLs.](/assets/guides/github-app/setup-and-webhook.png)

4. Open **Repository permissions**. Grant **Contents** read-only access; GitHub grants **Metadata** read-only access automatically. For Preview deployments, grant **Deployments** and **Pull requests** read and write access.

   ![Open the GitHub App repository permissions.](/assets/guides/github-app/repository-permissions.png)

   ![Grant Contents read-only access.](/assets/guides/github-app/contents-permission.png)

   ![Grant Deployments and Pull requests read and write access for Previews.](/assets/guides/github-app/preview-permissions.png)

5. Under **Subscribe to events**, select **Push** and **Pull request**. GitHub sends `installation` and `installation_repositories` events to GitHub Apps automatically; they do not appear as selectable events. [GitHub documents this behavior](https://docs.github.com/en/webhooks/webhook-events-and-payloads#installation).

   ![Subscribe the GitHub App to Pull request and Push events.](/assets/guides/github-app/subscribe-events.png)

6. Choose **Only on this account** unless you intend other accounts to install your App, then create it. On **General**, copy the App ID and slug for the Towbar configuration.

   ![Choose the GitHub App installation scope and create it.](/assets/guides/github-app/installation-scope.png)

7. On **General**, generate a private key. GitHub downloads a PEM file. Keep it outside the repository, encode it as a single-line Base64 value, and add the App details to `/etc/towbar/config.yml`:

   ![Generate a private key for the GitHub App.](/assets/guides/github-app/private-key.png)

```yaml title="/etc/towbar/config.yml"
integrations:
  github:
    enabled: true
    appId: "123456"
    appSlug: your-towbar-app
    privateKeyBase64: <base64-encoded-pem>
    apiUrl: https://api.github.com
```

Encode the PEM with `base64 < private-key.pem | tr -d '\n'`. If you set a webhook secret in GitHub, add `webhookSecret: <shared-webhook-secret>` under `integrations.github`. Towbar verifies GitHub webhook signatures when this value is configured. Without it, Towbar accepts unsigned webhook deliveries, so configure a secret when possible. Validate and restart Towbar. Startup fails if the key cannot be parsed or a required enabled field is missing.

## Install and use it

Open **Manage → Integrations → GitHub** and choose **Install GitHub App**. Select only the accounts and repositories Towbar should manage. The connection widget is shown only because the runtime configuration is valid; no credential form is exposed.

<div className="towbar-doc-screenshot">
  <div className="towbar-product-light">
    <img
      src="/assets/release-v2/github-setup-light.jpg"
      alt="GitHub shows runtime App availability before an installation is connected."
      width="2560"
      height="1440"
      loading="lazy"
    />
  </div>
  <div className="towbar-product-dark">
    <img
      src="/assets/release-v2/github-setup-dark.jpg"
      alt="GitHub shows runtime App availability before an installation is connected."
      width="2560"
      height="1440"
      loading="lazy"
    />
  </div>
  <p>
    The installation action appears after the GitHub App configuration values
    pass startup validation.
  </p>
</div>

After changing App permissions, approve the update in GitHub. Disconnecting removes Towbar's active installation access while leaving the runtime App identity unchanged. Use the connection status in Towbar and GitHub's webhook delivery history to diagnose access or delivery failures.

## Verify access

The connection card shows the installed account, account type, installation ID, and Preview reporting readiness. A healthy installation must remain active in GitHub and include Contents read access. Preview reporting also needs Pull requests and Deployments read and write access. Towbar never displays the App private key or webhook secret.

## Maintain the connection

Use **Review permissions** after adding App permissions or repositories. Use **Reconnect GitHub** when GitHub suspends or removes the installation. If webhooks stop arriving, inspect the App’s recent deliveries in GitHub and confirm that the callback URL uses `installation.appUrl`. Rotate the private key or configured webhook secret in `config.yml`, then validate and restart Towbar.
