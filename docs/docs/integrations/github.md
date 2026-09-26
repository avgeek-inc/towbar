---
title: "GitHub"
description: "Configure a GitHub App in Towbar's YAML configuration, install it, and connect repositories."
icon: "/assets/integration-logos/github.svg"
---

<img className="towbar-doc-brand-logo" src="/assets/integration-logos/github.svg" alt="" aria-hidden="true" />

Towbar uses one GitHub App per installation. The App identity and secrets live in `/etc/towbar/towbar.yml`. PostgreSQL stores the selected installation and account metadata, never the App private key or webhook secret.

## Create and configure the App

1. Open [GitHub's new App form](https://github.com/settings/apps/new). Give the App a unique name and a homepage URL. After registration, GitHub shows its App ID on **General**. Copy that ID and the App's slug for the Towbar configuration.

   ![GitHub App General settings after registering a temporary example App, including the App ID.](/assets/guides/github-app/register.webp)

2. Set **Setup URL** to `https://towbar.example.com/manage/integrations/github` and enable **Redirect on update**. Keep the webhook active, set **Webhook URL** to `https://towbar.example.com/v1/public/webhooks/github`, and leave SSL verification enabled. Replace `towbar.example.com` in both URLs with your `installation.appUrl` origin. Generate a webhook secret and enter the same value in GitHub and Towbar. The example screenshot leaves the secret field empty so no secret appears in the guide.

   ![GitHub App post-installation and webhook URL settings using example Towbar URLs.](/assets/guides/github-app/webhook.webp)

3. Under **Repository permissions**, grant **Contents** read-only access. **Metadata** read-only access is mandatory. For Preview deployments, grant **Pull requests** and **Deployments** read and write access. Choose **Only on this account** unless you intend other accounts to install your App.

   ![Selecting read and write access for the Pull requests repository permission.](/assets/guides/github-app/permissions.webp)

4. Under **Subscribe to events**, select **Push** and **Pull request**. GitHub sends `installation` and `installation_repositories` events to GitHub Apps automatically; they do not appear as selectable events. [GitHub documents this behavior](https://docs.github.com/en/webhooks/webhook-events-and-payloads#installation).

   ![Selecting the Push and Pull request webhook events in GitHub App settings.](/assets/guides/github-app/events.webp)

5. On **General**, generate a private key. GitHub downloads a PEM file. Keep it outside the repository, encode it as a single-line Base64 value, and add the App details to `/etc/towbar/towbar.yml`:

   ![Generate a private key action in GitHub App General settings.](/assets/guides/github-app/private-key.webp)

```yaml title="/etc/towbar/towbar.yml"
integrations:
  github:
    enabled: true
    appId: "123456"
    appSlug: your-towbar-app
    privateKeyBase64: <base64-encoded-pem>
    webhookSecret: <shared-webhook-secret>
    apiUrl: https://api.github.com
```

Encode the PEM with `base64 < private-key.pem | tr -d '\n'`. Validate and restart Towbar. Startup fails if the key cannot be parsed or any enabled field is missing.

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

Use **Review permissions** after adding App permissions or repositories. Use **Reconnect GitHub** when GitHub suspends or removes the installation. If webhooks stop arriving, inspect the App’s recent deliveries in GitHub and confirm that the callback URL uses `installation.appUrl`. Rotate the private key or webhook secret in `towbar.yml`, then validate and restart Towbar.
