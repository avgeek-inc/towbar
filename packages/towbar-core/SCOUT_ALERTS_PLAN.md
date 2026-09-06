# Scout Alerts and deployment comparisons

Implementation and handoff checklist for the active feature. This is engineering
tracking, not a substitute for working behaviour or published documentation.

## Scope

- [x] Configurable host and workload alerts: CPU, memory, root/Docker disk,
      container restart loops, and missing Scout reports. Additional reported
      gauges should use the same rule model. Opt-in presets, threshold direction,
      threshold, restart counting window, severity and enabled state. Recovery follows the
      first healthy reading; all server destinations receive one alert per incident.
- [x] Persistent incidents, deduplicated firing/recovery, no active repeats,
      rule and server maintenance mutes, and readable active/resolved history.
      Missing measurements must not count as zero or prove recovery. Backfilled
      samples must not generate stale alerts. Installation grace and intentional
      uninstall must not generate offline notifications.
- [x] Reuse Slack/SMTP delivery with all server destinations for server and workload rules. Durable outbox and retry behaviour; test delivery and visible
      errors. Muted incidents must not send stale notifications on recovery.
- [x] Bounded durable evaluator independent of ingestion and UI. Safe concurrency,
      rule edits, deletion, scope/archive changes, retention, and worker restarts.
- [x] Public HTTP uptime checks (recommended follow-on included for completeness):
      configurable interval/timeout/status expectations, bounded response handling,
      public-address-only DNS pinning and redirect checks, no arbitrary headers or
      credentials, and shared incident/delivery lifecycle.
- [x] Compare any two successful deployments of the same workload/environment.
      Equal relative windows after readiness, configurable warm-up/window and
      regression sensitivity, deployment identity/commit/config context, bounded
      aligned graphs, summaries/deltas, sample coverage and incomplete/expired
      history warnings. CPU, memory, restarts and available I/O; do not imply
      performance causation or measure latency/error rate without instrumentation.
- [x] Polished Scout Alerts and Compare UI using existing components. Accessible
      keyboard/empty/error/loading states, light/dark/mobile checks, no whole-tab
      reload or large synchronous chart work. Fixture covers meaningful states.
- [x] Workspace isolation and owner-only mutations. REST contracts and meaningful
      MCP tools for inspection/configuration/comparison; notification destination
      management stays browser-only per existing user preference.
- [x] Comprehensive Mintlify guidance/routes, README feature update, focused
      evaluator/integration/authorization/comparison tests and actual browser QA.
- [x] Open the focused PR with verification evidence.

## Design decisions

Rules and incidents live in the control-plane database. The agent continues its
existing 30-second collection contract. A dedicated durable sweep evaluates rules
without waiting for another sample, allowing missing-report detection. Workload
rules bind to stable workload identity and explicitly select production/previews.
Deployment comparisons bind to deployment labels, not wall-clock guesswork.

Host notifications require server-scoped destinations because servers may exist
without a source. Existing source destinations remain valid and unchanged.
Notification transitions are committed atomically with their durable delivery
intent. External delivery happens outside the evaluator transaction.

The 80% chart reference is not an automatic notification rule. Default presets
use sustained conditions and are only enabled by the user. No automatic restarts,
rollbacks, server cleanup, external notifications, or live installation changes
are part of local feature validation.

## Implementation and verification

Branch: `feat/scout-alerts-comparisons`, based on merged provider work on main.
PR: [#83](https://github.com/avgeek-inc/towbar/pull/83). GitHub reports CI for each revision.

Implemented shared schemas, persistent rules/incidents/HTTP claims, additive
migrations, owner-scoped REST mutations, curated MCP tools, server notification
destinations, and a durable Temporal evaluation loop. The Scout web surfaces have
Performance, Alerts, Notifications (server), and Compare deployments (workload)
panels. Mintlify includes reference routes, detailed guides, and light/dark
screenshots; README points readers to the new capabilities.

Verified locally:

- Full `pnpm verify` with the isolated PostgreSQL test database: formatting,
  lint, typechecks, unit/integration tests, migration rehearsal, and production
  build. API tests include REST/MCP owner, read-key, and workspace boundaries.
- `pnpm docs:api:check`: 121 response handlers, 116 public operations, 55 curated
  MCP tools. Notification destination management remains browser-only.
- Alert tests cover concurrent claims/evaluation, deduplicated delivery intents,
  immediate recovery, missing data, maintenance mutes, config changes, destination
  category changes, server archival, suppressed retries, restart-window boundaries,
  HTTP config revisions, and active-incident retention. Provider acknowledgement
  is simulated; no real Slack/email message was sent.
- HTTP probe tests cover non-public addresses, mixed DNS answers, address pinning,
  redirect targets/limits, expected statuses, credentials/protocol rejection, and
  a shared request deadline. These use an injected transport, not live websites.
- Deployment tests cover identical/wrong-workload/cross-tenant IDs, successful
  deployment requirements, weighted coverage, replacement containers, missing or
  expired history, and relative/absolute sensitivity with average/peak selection.
- A real isolated local Temporal server ran the Scout loop, retained a wake signal
  across worker restart, and replayed persisted history successfully. Activity
  execution was mocked; this does not claim live infrastructure verification.
- Chromium fixture QA covers rule creation, HTTP configuration, maintenance mute,
  notification destinations, incomplete and complete comparisons, dark/light mode,
  and 390px layouts. Comparison changes retain heading/results DOM nodes. After
  applying the existing staged chart scheduler, repeated comparison changes
  produced no browser long tasks over 50 ms in the tested desktop fixture.

## Operational limits

The existing agent binary and reporting contract are unchanged. Rules are opt-in.
The evaluator considers at most 100 oldest-due rules per sweep with bounded
transactions and per-rule failure isolation. HTTP checks claim at most 20 attempts
per sweep with four concurrent probes and at most ten seconds per probe. A server
admits at most 100 rules, including ten HTTP checks. Under load, checks may run
later than their requested interval; missing observations never establish health.

Public HTTP checks originate from the control plane, cannot detect that plane's
own outage, and do not replace an independent external uptime service. Comparison
results describe resource usage, not causation, latency, or application error
rates. Peak totals may combine container maxima that did not occur simultaneously.

The fixture exercises presentation and state transitions; actual provider delivery
and live server behavior remain distinct. This PR does not install or configure
rules on production servers, cut a release, or enable external notifications.
