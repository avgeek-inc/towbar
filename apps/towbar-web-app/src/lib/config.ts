import { publicApiOrigin } from "./public-api-origin";

export const config = {
  get apiBaseUrl() {
    if (typeof document !== "undefined") {
      const origin = document.querySelector<HTMLMetaElement>(
        'meta[name="towbar-api-origin"]',
      )?.content;
      if (!origin) throw new Error("Towbar public API origin is missing");
      return publicApiOrigin(origin);
    }
    return publicApiOrigin(
      process.env.TOWBAR_API_BASE_URL ?? "http://localhost:4020",
    );
  },
} as const;

export function canShowApiMcpSettings(
  apiBaseUrl = config.apiBaseUrl,
  isDevelopment = process.env.NODE_ENV === "development",
  isPublicDemo = process.env.NEXT_PUBLIC_TOWBAR_PUBLIC_DEMO === "true",
) {
  if (isPublicDemo) return true;
  const url = new URL(apiBaseUrl);
  if (url.protocol === "https:") return true;
  return (
    isDevelopment &&
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
    url.port === "4420"
  );
}
