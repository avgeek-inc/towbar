---
title: "GitHub"
description: "Configure a GitHub App in Towbar's YAML configuration, install it, and connect repositories."
---

Towbar uses one GitHub App per installation. The App identity and secrets live in `/etc/towbar/towbar.yml`. PostgreSQL stores the selected installation and account metadata, never the App private key or webhook secret.

## Create and configure the App

Create a GitHub App with repository Contents and Metadata read access. Grant Pull requests and Deployments read and write access when using Preview deployments. Subscribe to `push`, `pull_request`, and `installation` events.

Set the webhook URL to `https://towbar.example.com/v1/public/webhooks/github` and the setup URL to `https://towbar.example.com/manage/integrations/github`, using your `installation.appUrl` origin, with redirect enabled. Generate a private key, then add this to `/etc/towbar/towbar.yml`:

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
