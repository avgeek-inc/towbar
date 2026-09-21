export const config = {
  apiBaseUrl:
    process.env.NEXT_PUBLIC_TOWBAR_API_BASE_URL ?? "http://localhost:4021",
} as const;

export const hasHttpsExternalAccess =
  new URL(config.apiBaseUrl).protocol === "https:";
