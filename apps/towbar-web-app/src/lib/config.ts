export const config = {
  get appBaseUrl() {
    if (process.env.NEXT_PUBLIC_TOWBAR_APP_BASE_URL)
      return process.env.NEXT_PUBLIC_TOWBAR_APP_BASE_URL;
    if (typeof window !== "undefined") return window.location.origin;
    return process.env.TOWBAR_APP_BASE_URL ?? "http://localhost:4021";
  },
} as const;

export function canShowApiMcpSettings(
  appBaseUrl = config.appBaseUrl,
  isDevelopment = process.env.NODE_ENV === "development",
) {
  const url = new URL(appBaseUrl);
  if (url.protocol === "https:") return true;
  return (
    isDevelopment &&
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
    url.port === "4420"
  );
}
