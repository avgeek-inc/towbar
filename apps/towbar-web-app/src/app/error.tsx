"use client";

import { captureException } from "@workspace/web-design-system/lib/sentry";
import { useEffect } from "react";

import { ErrorScreen } from "@/components/error-screen";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureException(error);
  }, [error]);

  return (
    <ErrorScreen
      code="500"
      title="We couldn't load this page"
      description="The page ran into a problem. Try again, or return to the overview if it keeps happening."
      onRetry={reset}
    />
  );
}
