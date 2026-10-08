"use client";

import { ErrorScreen } from "@/components/error-screen";

export default function Error({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <ErrorScreen
      code="500"
      title="We couldn't load this page"
      description="The page ran into a problem. Try again, or return to the overview if it keeps happening."
      onRetry={retry}
    />
  );
}
