import type { ServerResponse } from "node:http";
import {
  defaultDateTimePreferences,
  localizedResponse,
  type DateTimePreferences,
} from "@workspace/towbar-core/date-time";

const preferencesByResponse = new WeakMap<
  ServerResponse,
  () => DateTimePreferences
>();
export function useFixtureLocalization(
  response: ServerResponse,
  preferences: () => DateTimePreferences,
) {
  preferencesByResponse.set(response, preferences);
}
export function fixtureJson(response: ServerResponse, payload: unknown) {
  return JSON.stringify(
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? localizedResponse(
          payload as Record<string, unknown>,
          preferencesByResponse.get(response)?.() ?? defaultDateTimePreferences,
        )
      : payload,
  );
}
