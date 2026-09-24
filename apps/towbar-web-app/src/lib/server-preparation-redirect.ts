import type {
  ServerCheck,
  ServerPreparation,
} from "@workspace/towbar-web-client";

export function hasScheduledPostSetupCheck(
  preparation: ServerPreparation | undefined,
  check: ServerCheck | null | undefined,
) {
  return Boolean(
    preparation?.status === "succeeded" &&
    check &&
    check.errorCode !== "TEMPORAL_UNAVAILABLE" &&
    Date.parse(check.createdAt) > Date.parse(preparation.createdAt),
  );
}
