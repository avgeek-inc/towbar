import {
  captureRequestError,
  registerSentry,
} from "@workspace/web-design-system/lib/sentry";

export async function register() {
  await registerSentry();
}

export const onRequestError = captureRequestError;
