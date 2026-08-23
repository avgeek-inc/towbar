import {
  captureRouterTransitionStart,
  initializeSentryClient,
} from "@workspace/web-design-system/lib/sentry-client";

initializeSentryClient();

export const onRouterTransitionStart = captureRouterTransitionStart;
