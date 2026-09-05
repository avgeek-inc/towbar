"use client";

import { useSyncExternalStore } from "react";
import type { Deployment } from "@workspace/towbar-web-client";
import {
  formatElapsedTime,
  isEventRunning,
  type TimedEvent,
} from "@/lib/elapsed-time";

const listeners = new Set<() => void>();
let now = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((notify) => notify());
    }, 1_000);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}
const getSnapshot = () => now;
const getServerSnapshot = () => 0;
const subscribeIdle = () => () => {};

/** Only the live text subscribes; tables and API queries keep their own cadence. */
export function ElapsedTime(props: TimedEvent) {
  const running = isEventRunning(props);
  const currentTime = useSyncExternalStore(
    running ? subscribe : subscribeIdle,
    running ? getSnapshot : getServerSnapshot,
    getServerSnapshot,
  );
  return (
    <span className="whitespace-nowrap tabular-nums">
      {formatElapsedTime(props, currentTime)}
    </span>
  );
}

export function DeploymentDuration({
  deployment,
}: {
  deployment: Pick<Deployment, "startedAt" | "finishedAt" | "state">;
}) {
  return <ElapsedTime {...deployment} status={deployment.state} />;
}
