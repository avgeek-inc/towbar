export const config = {
  get appBaseUrl() {
    if (process.env.NEXT_PUBLIC_TOWBAR_APP_BASE_URL)
      return process.env.NEXT_PUBLIC_TOWBAR_APP_BASE_URL;
    if (typeof window !== "undefined") return window.location.origin;
    return process.env.TOWBAR_APP_BASE_URL ?? "http://localhost:4021";
  },
} as const;

export function hasHttpsExternalAccess() {
  return new URL(config.appBaseUrl).protocol === "https:";
}
