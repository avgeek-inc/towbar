import * as Sentry from "@sentry/nextjs";
import { initializeSentry } from "./sentry";
export function initializeSentryClient() {
  initializeSentry("browser");
}
export const captureRouterTransitionStart = Sentry.captureRouterTransitionStart;
