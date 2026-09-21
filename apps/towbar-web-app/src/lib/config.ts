export const config = {
  appBaseUrl:
    process.env.NEXT_PUBLIC_TOWBAR_APP_BASE_URL ?? "http://localhost:4021",
} as const;

export const hasHttpsExternalAccess =
  new URL(config.appBaseUrl).protocol === "https:";
