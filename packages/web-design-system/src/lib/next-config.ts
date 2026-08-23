import path from "node:path";
import type { NextConfig } from "next";

export type { NextConfig };
export function createNextConfig(
  wrap: (config: NextConfig) => NextConfig,
  options: { sentryProject: string; transpilePackages?: string[] },
): NextConfig {
  const config: NextConfig = {
    output: "standalone",
    poweredByHeader: false,
    turbopack: { root: path.resolve(process.cwd(), "../..") },
    transpilePackages: [
      "@workspace/web-design-system",
      ...(options.transpilePackages ?? []),
    ],
    async headers() {
      return [
        {
          source: "/(.*)",
          headers: [
            { key: "X-Content-Type-Options", value: "nosniff" },
            { key: "X-Frame-Options", value: "DENY" },
            {
              key: "Referrer-Policy",
              value: "strict-origin-when-cross-origin",
            },
            {
              key: "Permissions-Policy",
              value: "camera=(), microphone=(), geolocation=()",
            },
          ],
        },
      ];
    },
  };
  return wrap(config);
}
