# Scout Alerts and deployment comparisons

Implementation and handoff checklist for the active feature. This is engineering
tracking, not a substitute for working behaviour or published documentation.

## Scope

- [ ] Configurable host and workload alerts: CPU, memory, root/Docker disk,
      container restart loops, and missing Scout reports. Additional reported
      gauges should use the same rule model. Opt-in presets, threshold direction,
      sustained duration/window, recovery threshold/duration, severity, enabled
      state, repeat interval (off by default), and notification destinations.
- [ ] Persistent incidents, deduplicated firing/recovery, bounded reminders,
      rule and server maintenance mutes, and readable active/resolved history.
      Missing measurements must not count as zero or prove recovery. Backfilled
      samples must not generate stale alerts. Installation grace and intentional
      uninstall must not generate offline notifications.
- [ ] Reuse Slack/SMTP delivery with server destinations plus source destinations
      for workloads. Durable outbox and retry behaviour; test delivery and visible
      errors. Muted incidents must not send stale notifications on recovery.
- [ ] Bounded durable evaluator independent of ingestion and UI. Safe concurrency,
      rule edits, deletion, scope/archive changes, retention, and worker restarts.
- [ ] Public HTTP uptime checks (recommended follow-on included for completeness):
      configurable interval/timeout/status expectations, bounded response handling,
      public-address-only DNS pinning and redirect checks, no arbitrary headers or
      credentials, and shared incident/delivery lifecycle.
- [ ] Compare any two successful deployments of the same workload/environment.
      Equal relative windows after readiness, configurable warm-up/window and
      regression sensitivity, deployment identity/commit/config context, bounded
      aligned graphs, summaries/deltas, sample coverage and incomplete/expired
      history warnings. CPU, memory, restarts and available I/O; do not imply
      performance causation or measure latency/error rate without instrumentation.
- [ ] Polished Scout Alerts and Compare UI using existing components. Accessible
      keyboard/empty/error/loading states, light/dark/mobile checks, no whole-tab
      reload or large synchronous chart work. Fixture covers meaningful states.
- [ ] Workspace isolation and owner-only mutations. REST contracts and meaningful
      MCP tools for inspection/configuration/comparison; notification destination
      management stays browser-only per existing user preference.
- [ ] Comprehensive Mintlify guidance/routes, README feature update, focused
      evaluator/integration/authorization/comparison tests and actual browser QA.
- [ ] Complete repository gates and open a focused PR with verified evidence.

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

## Implementation checkpoint

Branch: `feat/scout-alerts-comparisons`, based on merged provider work on main.
The first implementation stage adds validated shared contracts, a deterministic
condition evaluator, database rules/settings/incidents, scoped REST handlers,
server notification destinations, an atomic incident/delivery outbox, and a
dedicated Temporal evaluation loop. The comparison query uses deployment labels,
equal post-completion windows, bounded aligned points and coverage-aware summaries.

Verified locally at this checkpoint:

- 13 shared evaluator/comparison unit tests.
- 13 PostgreSQL alert/comparison tests, including suite-level tests. These cover
  concurrent sweeps, workspace isolation, delivery deduplication, recovery,
  maintenance mute, condition edits, replacements, missing/expired history.
- API, worker and web typechecks before the final helper extraction; API typecheck
  and both PostgreSQL suites repeated successfully after that extraction.
- Changed evaluator and notification helpers pass ESLint after decomposition.

No UI screens, fixture proof, full repository gates, generated API docs, MCP
tools, public uptime probes, or PR handoff are complete yet. Do not infer those
from the backend tests. Notifications were verified through stored delivery
records and a simulated provider acknowledgement; no external message was sent.

Next implementation/verification work:

1. Complete the rule editor, incident history, server destinations, maintenance
   controls and comparison screens. Reuse current design system controls and keep
   chart changes local. Include readable units and severity/status text.
2. Add browser fixtures, permission tests, missing-report/restart rule integration
   tests, mute-before-delivery suppression tests and retention tests. Test the
   dedicated Temporal workflow rather than treating its source as runtime proof.
3. Audit evaluator robustness: statement/transaction time bounds, per-rule failure
   isolation, fair scheduling, exact restart-window boundaries and blackout
   coverage, invalid stored configs, cross-container missing measurements, and
   rule edits versus queued notifications. The raw-sample helper and SQL restart
   implementation currently have separate paths and need consistency review.
4. Complete comparison settings and evidence: configurable absolute sensitivity,
   average/peak selection, restart coverage/assessment, partial rollup boundaries,
   environment isolation and concurrent-container peak semantics. Test these
   cases before describing the comparison as comprehensive.
5. Add public HTTP probes with SSRF-safe address pinning and bounded execution;
   `httpAvailability` is currently a reserved condition, not a working check.
6. Generate REST schemas/docs and add meaningful MCP tools. Review new endpoint
   categorization; current comparison routes use `/workloads/:deployableId`.
7. Update Mintlify/README, run repository gates, inspect all screens in light/dark
   and narrow layouts, and open the PR only when the whole scope is verified.
