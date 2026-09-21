"use client";

import { createTowbarClient } from "@workspace/towbar-web-client";

import { config } from "./config";
import {
  localizationGeneration,
  receiveDateTimeLabels,
} from "./date-time-display";

export const api = createTowbarClient({
  baseUrl: config.apiBaseUrl,
  requestContext: localizationGeneration,
  onResponse: (payload, generation) => {
    if (
      receiveDateTimeLabels(payload, generation) &&
      typeof window !== "undefined"
    )
      window.dispatchEvent(new Event("towbar:preferences-changed"));
  },
  onReauthenticationRequired: () =>
    new Promise((resolve) =>
      window.dispatchEvent(
        new CustomEvent("towbar:reauthenticate", { detail: { resolve } }),
      ),
    ),
  onAccessError: (error) => {
    if (
      typeof window !== "undefined" &&
      error.code !== "REAUTHENTICATION_REQUIRED"
    )
      window.dispatchEvent(new Event("towbar:access-error"));
  },
});
