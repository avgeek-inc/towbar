"use client";

import { useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertCircleIcon,
  CheckmarkCircle02Icon,
  ReloadIcon,
} from "@hugeicons/core-free-icons";
import type {
  TowbarUpgradeJob,
  TowbarUpgradePlan,
  TowbarUpgradeStatus,
} from "@workspace/towbar-web-client";
import { Button } from "@avgeek-oss/design-system/buttons/button";
import { AlertDialog } from "@avgeek-oss/design-system/overlays/alert-dialog";
import { Spinner } from "@avgeek-oss/design-system/feedback/spinner";
import { InlineExternalLink } from "@avgeek-oss/design-system/navigation/inline-external-link";
import { useApiQuery, refreshApiQueries } from "@/hooks/use-api-query";
import { api } from "@/lib/api";
import {
  upgradeCanReview,
  upgradeIsActive,
  upgradeNeedsRecovery,
} from "./host-upgrade-state";

const path = "/v1/core/system-health/upgrade";

export function HostUpgrade({
  targetVersion,
  onJobChange,
}: {
  targetVersion?: string | null;
  onJobChange?: (job: TowbarUpgradeJob | undefined) => void;
}) {
  const status = useApiQuery<TowbarUpgradeStatus>(path, 3_000);
  const [open, setOpen] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [plan, setPlan] = useState<TowbarUpgradePlan>();
  const [submitted, setSubmitted] = useState<TowbarUpgradeJob>();
  const [requestId, setRequestId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [uncertain, setUncertain] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  const job =
    status.data?.job &&
    (!submitted || status.data.job.updatedAt >= submitted.updatedAt)
      ? status.data.job
      : submitted;
  const active = upgradeIsActive(job?.state);
  const recovery = upgradeNeedsRecovery(job?.state);
  const canReview = Boolean(
    status.data?.supported && upgradeCanReview(targetVersion, job),
  );
  const showJob = Boolean(job && (!reviewing || active || recovery));
  const succeeded = job?.state === "succeeded";
  const heading = !showJob
    ? "Upgrade Towbar"
    : active
      ? "Upgrade in progress"
      : succeeded
        ? "Upgrade successful"
        : recovery
          ? "Upgrade failed"
          : job?.state === "recovered"
            ? "Recovery complete"
            : "Upgrade can’t start yet";

  useEffect(() => {
    if (job?.state === "succeeded") refreshApiQueries();
  }, [job?.state]);
  useEffect(() => {
    onJobChange?.(job);
  }, [onJobChange, job]);
  useEffect(() => {
    if (open && showJob && !busy) closeButton.current?.focus();
  }, [busy, open, showJob]);

  async function prepare() {
    setReviewing(true);
    setOpen(true);
    setBusy(true);
    setError(undefined);
    if (!open) setPlan(undefined);
    setUncertain(false);
    try {
      const result = await api.post<TowbarUpgradePlan>(`${path}/plan`, {
        targetVersion: `v${targetVersion}`,
      });
      setPlan(result);
      setRequestId(crypto.randomUUID());
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The release could not be checked. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    if (!plan || !requestId) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await api.post<TowbarUpgradeJob>(`${path}/jobs`, {
        planId: plan.id,
        requestId,
      });
      setSubmitted(result);
      setUncertain(false);
      setReviewing(false);
      status.refresh();
    } catch (cause) {
      setUncertain(true);
      setError(
        cause instanceof Error
          ? cause.message
          : "The request could not be confirmed.",
      );
      status.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="ml-8 flex flex-wrap items-center gap-2 sm:ml-0 sm:justify-end">
        {canReview ? (
          <div>
            <Button variant="primary" onPress={() => void prepare()}>
              Review upgrade
            </Button>
          </div>
        ) : job ? (
          <Button
            variant="secondary"
            onPress={() => {
              setReviewing(false);
              setOpen(true);
            }}
          >
            View upgrade
          </Button>
        ) : null}
      </div>
      {status.data?.supported === false ? (
        <p className="ml-8 text-sm text-warning sm:col-span-2">
          {status.data.reason}
        </p>
      ) : null}
      {status.error && !job ? (
        <p className="ml-8 text-sm text-warning sm:col-span-2" role="status">
          {active || uncertain
            ? "Reconnecting to Towbar. The host keeps running the upgrade. This page will check again automatically."
            : status.error}{" "}
          <UpgradeRecoveryLink />
        </p>
      ) : null}
      <AlertDialog.Backdrop
        isOpen={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <AlertDialog.Container>
          <AlertDialog.Dialog className="max-h-[90dvh] sm:max-w-lg">
            <AlertDialog.Header>
              <AlertDialog.Heading className="flex items-center gap-2">
                {showJob && active ? (
                  <Spinner
                    size="sm"
                    color="current"
                    className="text-warning-soft-foreground"
                    aria-hidden="true"
                  />
                ) : (
                  <HugeiconsIcon
                    aria-hidden="true"
                    className={
                      showJob && recovery
                        ? "size-5 shrink-0 text-danger-soft-foreground"
                        : showJob && succeeded
                          ? "size-5 shrink-0 text-success-soft-foreground"
                          : "size-5 shrink-0 text-muted"
                    }
                    icon={
                      showJob && recovery
                        ? AlertCircleIcon
                        : showJob && succeeded
                          ? CheckmarkCircle02Icon
                          : ReloadIcon
                    }
                  />
                )}
                {heading}
              </AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body className="grid gap-4 overflow-y-auto">
              {showJob && job ? (
                <div className="grid gap-4" role="status" aria-live="polite">
                  <p className="text-sm text-muted tabular-nums">
                    {job.currentVersion} → {job.targetVersion}
                  </p>
                  <p className="text-sm text-muted">
                    {status.error && active
                      ? "Reconnecting to Towbar. The upgrade continues on the host. This page reconnects automatically."
                      : job.state === "applying"
                        ? `Towbar is updating the database and replacing its services with ${job.targetVersion}. This page may briefly disconnect while the services restart. It will reconnect automatically and show the result here.`
                        : job.state === "interrupted"
                          ? "The upgrade was interrupted before Towbar recorded a final result. Recovery is required before another upgrade."
                          : job.message}
                  </p>
                  {status.error && !active ? (
                    <p className="text-sm text-muted">
                      Can’t refresh the status. Showing the last update;
                      retrying automatically.
                    </p>
                  ) : null}
                  {job.blockers.length ? (
                    <ul className="grid gap-1 text-sm text-muted">
                      {job.blockers.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  ) : null}
                  {recovery || status.error ? <UpgradeRecoveryLink /> : null}
                </div>
              ) : (
                <>
                  {busy && !plan ? (
                    <p className="flex items-center gap-2">
                      <Spinner size="sm" />
                      Checking the release and host readiness…
                    </p>
                  ) : null}
                  {plan ? (
                    <>
                      <p className="text-sm text-muted">
                        You’re currently running Towbar{" "}
                        <span className="font-medium text-foreground tabular-nums">
                          {plan.currentVersion}
                        </span>
                        . A newer version,{" "}
                        <span className="font-medium text-foreground tabular-nums">
                          {plan.targetVersion}
                        </span>
                        , is available for this installation.{" "}
                        <InlineExternalLink
                          href={plan.releaseUrl}
                          rel="noopener noreferrer"
                          target="_blank"
                        >
                          Click here
                        </InlineExternalLink>{" "}
                        to view the changelog.
                      </p>
                      <div className="grid gap-2">
                        <p
                          className={
                            plan.blockers.length
                              ? "flex items-center gap-2 text-sm font-medium text-warning-soft-foreground"
                              : "flex items-center gap-2 text-sm text-success-soft-foreground"
                          }
                        >
                          <HugeiconsIcon
                            icon={
                              plan.blockers.length
                                ? AlertCircleIcon
                                : CheckmarkCircle02Icon
                            }
                            className="size-4 shrink-0"
                            aria-hidden="true"
                          />
                          {plan.blockers.length
                            ? "Upgrade can’t start yet"
                            : "No active work detected"}
                        </p>
                        {plan.blockers.length ? (
                          <ul className="grid gap-1 pl-6 text-sm text-muted">
                            {plan.blockers.map((item) => {
                              const label = item
                                .replace(
                                  /^Deployments:/u,
                                  "Ongoing Deployments:",
                                )
                                .replace(
                                  /^Resource operations:/u,
                                  "Ongoing resource operations:",
                                );
                              const parts = /^(.*:\s*)(\d+)$/u.exec(label);
                              return (
                                <li key={item}>
                                  {parts ? (
                                    <>
                                      {parts[1]}
                                      <span className="font-medium">
                                        {parts[2]}
                                      </span>
                                    </>
                                  ) : (
                                    label
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        ) : null}
                      </div>
                      {!plan.blockers.length ? (
                        <p className="text-sm text-muted">
                          New deployments pause during the upgrade. This page
                          reconnects automatically.
                        </p>
                      ) : null}
                    </>
                  ) : null}
                  {error ? (
                    <p role="alert" className="text-sm text-danger">
                      {error}
                    </p>
                  ) : null}
                  {uncertain ? (
                    <p className="text-sm">
                      The request hasn’t been confirmed yet. You can retry
                      safely; this won’t start a second upgrade.
                    </p>
                  ) : null}
                </>
              )}
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button
                ref={closeButton}
                variant="secondary"
                isDisabled={busy}
                onPress={() => setOpen(false)}
              >
                Close
              </Button>
              {showJob ? (
                canReview ? (
                  <Button variant="primary" onPress={() => void prepare()}>
                    Review upgrade
                  </Button>
                ) : null
              ) : plan?.blockers.length ? (
                <Button
                  variant="secondary"
                  className="transform-none!"
                  isPending={busy}
                  onPress={() => void prepare()}
                >
                  Check again
                </Button>
              ) : (
                <Button
                  variant="primary"
                  isDisabled={
                    busy ||
                    !plan ||
                    (plan.expiresAt * 1000 < Date.now() && !uncertain) ||
                    active ||
                    recovery
                  }
                  onPress={() => void start()}
                >
                  {busy
                    ? "Starting…"
                    : uncertain
                      ? "Retry upgrade"
                      : `Upgrade to ${plan?.targetVersion ?? "new version"}`}
                </Button>
              )}
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </>
  );
}

function UpgradeRecoveryLink() {
  return (
    <InlineExternalLink
      className="w-fit text-sm text-muted!"
      href="https://www.towbar.dev/docs/self-hosting/upgrades#recover-a-host-managed-attempt"
      target="_blank"
      rel="noopener noreferrer"
    >
      Read the recovery guide
    </InlineExternalLink>
  );
}
