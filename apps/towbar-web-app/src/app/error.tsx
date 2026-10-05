"use client";

import { ErrorScreen } from "@/components/error-screen";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorScreen
      code="500"
      title="We couldn't load this page"
      description="The page ran into a problem. Try again, or return to the overview if it keeps happening."
      onRetry={reset}
    />
  );
}
