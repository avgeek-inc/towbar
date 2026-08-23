"use client";

import * as React from "react";

type PageVisibilityIntervalOptions = {
  runImmediately?: boolean;
  runOnVisible?: boolean;
};

export function usePageVisibilityInterval(
  callback: () => void,
  delayMs: number | null,
  {
    runImmediately = false,
    runOnVisible = true,
  }: PageVisibilityIntervalOptions = {},
) {
  const callbackRef = React.useRef(callback);
  callbackRef.current = callback;

  React.useEffect(() => {
    if (delayMs === null) {
      return;
    }

    let intervalId: number | null = null;

    const stop = () => {
      if (intervalId === null) {
        return;
      }

      window.clearInterval(intervalId);
      intervalId = null;
    };

    const start = (runNow: boolean) => {
      stop();

      if (document.hidden) {
        return;
      }

      if (runNow) {
        callbackRef.current();
      }

      intervalId = window.setInterval(() => {
        callbackRef.current();
      }, delayMs);
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stop();
        return;
      }

      start(runOnVisible);
    };

    start(runImmediately);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [delayMs, runImmediately, runOnVisible]);
}
