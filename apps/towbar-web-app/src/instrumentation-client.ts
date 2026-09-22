import {
  captureRouterTransitionStart,
  initializeSentryClient,
} from "@workspace/web-design-system/lib/sentry-client";

void fetch("/runtime-config", { cache: "no-store" })
  .then((response) => response.json())
  .then((config: { sentryDsn?: string; sentryEnvironment?: string }) =>
    initializeSentryClient({
      dsn: config.sentryDsn,
      environment: config.sentryEnvironment,
    }),
  )
  .catch(() => initializeSentryClient());

export const onRouterTransitionStart = captureRouterTransitionStart;
