---
title: "Your first deployment"
description: "Take a Dockerfile service from a GitHub repository to a verified deployment on your Ubuntu server."
---

This guide takes one service through Repository sync, server setup, deployment, and route verification. Use the [example files in this repository](https://github.com/avgeek-inc/towbar/tree/main/examples) for a small HTTP app and health endpoint, or bring your own service.

## Before you begin

You need a running Towbar installation with an Admin account, a connected GitHub App, and an Ubuntu target you can administer. If those are not ready, follow [Install Towbar](/docs/self-hosting/installation), [Connect GitHub](/docs/integrations/github), and [Register a server](/docs/servers) first.

Use a domain you control for a public service. The examples use documentation-only IPs and hostnames; replace them with your own values.

## 1. Create your service repository

Create a GitHub repository and copy `server.mjs`, `Dockerfile`, and
`.dockerignore` from the example directory into its root. Grant the connected
GitHub App access to your repository. The service needs no dependencies or secrets.
Run it locally with Node.js 24 or newer:

```sh
node server.mjs
```

Open `http://localhost:3000` and check `http://localhost:3000/health`.

Create `towbar.yml` and `.towbar/services/hello-towbar.service.yml`, replacing the server IP and domain.
For a first deployment to production, use:

<CodeGroup>

```yaml title="towbar.yml" highlight={2-3}
version: 2
environments:
  production: {}
```

```yaml title=".towbar/services/hello-towbar.service.yml" highlight={4-18}
id: hello-towbar
name: Hello Towbar
deployment:
  type: dockerfile
  dockerfile: Dockerfile
  context: .
container:
  port: 3000
  resources:
    cpus: 0.5
    memory: 256m
health:
  path: /health
  timeoutSeconds: 60
domains:
  primary: hello.example.com
environments:
  production:
    server: 192.0.2.10
    tls:
      mode: direct
```

</CodeGroup>

Use the server IP registered in Towbar. Match the Dockerfile path, port, and health endpoint to your service. Point the domain at the target server and allow the traffic required by [Caddy and TLS](/docs/domains-tls).

Commit these files to the branch you will map to production in Towbar. Automatic deployment is deliberately omitted so you can verify the first release manually.

## 2. Add and sync the Repository

Open **Repositories → Add repository**, select the repository, then select production and map it to your branch. Wait for the initial sync, then open its result.

A successful sync imports **Hello Towbar** into the Repository's Services list. If it fails, correct the reported manifest field or missing server reference and sync again. A successful sync accepts configuration; it does not mean the service is running.

<div className="towbar-doc-screenshot">
  <div className="towbar-product-light">
    <img src="/assets/release-v2/repositories-light.jpg" alt="Repositories show their imported service and datastore inventories and latest sync time." width="3200" height="1800" loading="lazy" />
  </div>
  <div className="towbar-product-dark">
    <img src="/assets/release-v2/repositories-dark.jpg" alt="Repositories show their imported service and datastore inventories and latest sync time." width="3200" height="1800" loading="lazy" />
  </div>
  <p>Repositories show their imported service and datastore inventories and latest sync time.</p>
</div>

## 3. Verify the server

Open the target under **Servers → Settings → Configuration** and select a stored [SSH key](/docs/ssh-keys). You can choose **Add private key** inside the dropdown to generate or import one. Install its public key on the server before verifying access. Choose **Save**, compare the discovered host fingerprint with the server console through an independent channel, and trust it only if it matches. Towbar attaches the selected key after SSH authentication succeeds.

Choose **Prepare Server** and follow the steps until the host is **Ready**. If preparation fails, inspect the reported step instead of repeatedly requesting deployment.

## 4. Save service secrets

If your service needs secrets, declare their keys in the entity file’s top-level `secrets` field and sync the production environment. Open the production service instance’s **Settings → Secrets** page and fill the declared build, runtime, or hook values, then save. New required keys appear as unset; missing values block deployment, but do not block sync. To reuse a workspace value, set the service variable to `{{globals.KEY}}`. Shared values are not injected automatically.

The Hello Towbar example needs no secrets, so you can skip this step for your first deployment.

Saved values are hidden until an Admin reveals them with the eye icon. Leaving a replacement field untouched preserves its value. Saving does not start a deployment. See [Secrets in Towbar](/docs/secrets/towbar) for references and rotation.

## 5. Deploy

Open the service and choose **Deploy**. Follow the operation as Towbar fetches the commit, builds on the server, starts a candidate, checks health, and promotes the release.

If a stage fails, open its output and correct that failure before retrying. The [troubleshooting guide](/docs/troubleshooting) maps common symptoms to the next check.

<div className="towbar-doc-screenshot">
  <div className="towbar-product-light">
    <img src="/assets/release-v2/deployments-light.jpg" alt="Filter deployment history by status, trigger, and workload." width="3200" height="1800" loading="lazy" />
  </div>
  <div className="towbar-product-dark">
    <img src="/assets/release-v2/deployments-dark.jpg" alt="Filter deployment history by status, trigger, and workload." width="3200" height="1800" loading="lazy" />
  </div>
  <p>Filter deployment history by status, trigger, and workload.</p>
</div>

## 6. Verify the result

Confirm all four conditions:

- The Repository sync succeeded at the intended commit.
- The target server is Ready.
- The deployment reached Succeeded.
- The configured HTTPS domain serves the expected service version.

For a service without a public domain, verify it through its intended private client instead.

## Next steps

For your second deployment, edit the response in `server.mjs`, commit to the
branch mapped to production, and deploy again. Reload the public page to verify that your new code is
running.

Enable [automatic deployment](/docs/deployments#automatic-deployments), add [pull request previews](/docs/previews), or connect a [datastore](/docs/datastores). Configure [notifications](/docs/integrations/notifications) so failed operations reach the people who need to act.
