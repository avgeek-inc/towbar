import * as Sentry from "@sentry/nextjs";
import { initializeSentry, type SentryRuntimeConfig } from "./sentry";
export function initializeSentryClient(config?: SentryRuntimeConfig) {
  initializeSentry("browser", config);
}
export const captureRouterTransitionStart = Sentry.captureRouterTransitionStart;
