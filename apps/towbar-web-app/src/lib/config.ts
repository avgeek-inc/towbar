export const config = {
  apiBaseUrl:
    process.env.NEXT_PUBLIC_TOWBAR_API_BASE_URL ?? "http://localhost:4020",
} as const;
