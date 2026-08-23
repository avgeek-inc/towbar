export const config = {
  apiBaseUrl:
    process.env.NEXT_PUBLIC_TOWBAR_API_BASE_URL ?? "http://localhost:4020",
  appBaseUrl:
    process.env.NEXT_PUBLIC_TOWBAR_APP_BASE_URL ?? "http://localhost:4021",
} as const;
