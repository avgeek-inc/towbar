"use client";

import { captureException } from "@workspace/web-design-system/lib/sentry";
import { useEffect } from "react";

import "@workspace/web-design-system/styles/globals.css";
import { themeBootstrapScript } from "@workspace/web-design-system/lib/theme";

import { ErrorScreen } from "@/components/error-screen";

export default function GlobalError({
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
    <html data-theme="light" lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: themeBootstrapScript }}
          id="color-scheme-bootstrap"
        />
      </head>
      <body className="min-h-dvh">
        <ErrorScreen
          code="500"
          title="Towbar couldn't load"
          description="The app ran into a problem. Try again, or return to the overview if it keeps happening."
          onRetry={reset}
        />
      </body>
    </html>
  );
}
