---
title: "Secrets"
description: "Choose where deployment values live and how workloads receive them."
---

Towbar keeps secret values outside Git. An app or resource manifest declares the names it needs; values can be saved in Towbar or imported from an external provider when a deployment runs. Save a change, then deploy the affected workload to use it.

| Where values live        | Use it for                                                                         | Read next                                  |
| ------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------ |
| App or resource settings | Values belonging to one workload and environment                                   | [Workload secrets](/docs/secrets/workload) |
| Manage → Shared secrets  | Reusable values explicitly referenced by workloads                                 | [Shared secrets](/docs/secrets/shared)     |
| Infisical or Doppler     | A provider project or config whose secrets should be imported as runtime variables | [External secrets](/docs/secrets/external) |

These scopes do not silently override one another. Shared values are used only where a workload references them. If a Towbar value and an external source provide the same environment variable name, deployment stops so that you can choose one owner.

Provider credentials and server SSH keys are configured separately from workload secrets. Set up an [Infisical](/docs/integrations/infisical) or [Doppler](/docs/integrations/doppler) integration before using it in a manifest.
