"use client";

import "@workspace/web-design-system/styles/globals.css";
import { themeBootstrapScript } from "@workspace/web-design-system/lib/theme";

import { ErrorScreen } from "@/components/error-screen";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
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
