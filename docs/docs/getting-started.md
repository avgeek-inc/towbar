---
title: "Your first deployment"
description: "Take a Dockerfile app from a GitHub repository to a verified deployment on your Ubuntu server."
---

This guide takes one app through Source sync, server preparation, deployment, and route verification. Start with a small service whose Dockerfile and health endpoint already work locally.

## Before you begin

You need a running Towbar installation with an owner account, a connected GitHub App, and an Ubuntu target you can administer. If those are not ready, follow [Install Towbar](/docs/self-hosting/installation), [Connect GitHub](/docs/integrations/github), and [Register a server](/docs/servers) first.

Use a domain you control for a public app. The examples use documentation-only IPs and hostnames; replace them with your own values.

## 1. Commit a manifest

Create `.towbar/deployment.yml` in the app repository:

```yaml
version: 1
source:
  branch: main
apps:
  - id: web
    name: Web
    server: 203.0.113.10
    dockerfile: Dockerfile
    context: .
    container:
      port: 3000
      resources:
        cpus: 1
        memory: 1g
    health:
      path: /health
      timeoutSeconds: 60
    domains:
      primary: app.example.com
    tls:
      mode: direct
```

Use the server IP registered in Towbar. Match the Dockerfile path, port, and health endpoint to your app. Point the domain at the target server and allow the traffic required by [Caddy and TLS](/docs/domains-tls).

Commit this file to the branch in `source.branch`. Automatic deployment is deliberately omitted so you can verify the first release manually.

## 2. Add and sync the Source

Open **Sources → Add source** and select the repository. Wait for the initial sync, then open its result.

A successful sync imports **Web** into the Source's Apps list. If it fails, correct the reported manifest field or missing server reference and sync again. A successful sync accepts configuration; it does not mean the app is running.

<div className="towbar-doc-screenshot">
  <div className="towbar-product-light">
    <img src="/assets/features/sources-light.webp" alt="Example Sources inventory after importing repositories. Open a Source to inspect its apps and sync result." width="1800" height="624" loading="lazy" />
  </div>
  <div className="towbar-product-dark">
    <img src="/assets/features/sources-dark.webp" alt="Example Sources inventory after importing repositories. Open a Source to inspect its apps and sync result." width="1800" height="624" loading="lazy" />
  </div>
  <p>Example Sources inventory after importing repositories. Open a Source to inspect its apps and sync result.</p>
</div>

## 3. Verify the server

Open the target under **Servers**. Save its SSH private key in **Settings → Configuration**, then run a server check. Compare the discovered SSH fingerprint with the host's console through an independent channel before trusting it.

Choose **Prepare Server** and follow the steps until the host is **Ready**. If preparation fails, inspect the reported step instead of repeatedly requesting deployment.

## 4. Save application secrets

Open **App → Settings → Secrets** and select Production. Add build, runtime, or hook values as needed, then save. Values inherited from workspace Shared secrets and the Source appear with their origin.

Saved values are write-only. Leaving a replacement field untouched preserves its value. Saving does not start a deployment. See [Shared secrets](/docs/secrets) for precedence and rotation.

## 5. Deploy

Open the app and choose **Deploy**. Follow the operation as Towbar fetches the commit, builds on the server, starts a candidate, checks health, and promotes the release.

If a stage fails, open its output and correct that failure before retrying. The [troubleshooting guide](/docs/troubleshooting) maps common symptoms to the next check.

<div className="towbar-doc-screenshot">
  <div className="towbar-product-light">
    <img src="/assets/deployments-light.webp" alt="Example deployment history showing queued, active, successful, and failed attempts." width="2400" height="1290" loading="lazy" />
  </div>
  <div className="towbar-product-dark">
    <img src="/assets/deployments-dark.webp" alt="Example deployment history showing queued, active, successful, and failed attempts." width="2400" height="1290" loading="lazy" />
  </div>
  <p>Example deployment history showing queued, active, successful, and failed attempts.</p>
</div>

## 6. Verify the result

Confirm all four conditions:

- The Source sync succeeded at the intended commit.
- The target server is Ready.
- The deployment reached Succeeded.
- The configured HTTPS domain serves the expected app version.

For an app without a public domain, verify it through its intended private client instead.

## Next steps

Enable [automatic deployment](/docs/deployments#automatic-deployments), add [pull request previews](/docs/previews), or connect a [database resource](/docs/resources). Configure [notifications](/docs/integrations/notifications) so failed operations reach the people who need to act.
