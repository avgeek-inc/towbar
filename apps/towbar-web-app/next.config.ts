import { createNextConfig } from "@workspace/web-design-system/lib/next-config";
import type { NextConfig } from "next";

const baseConfig = createNextConfig((config) => config, {
  sentryProject: "towbar-web-app",
  transpilePackages: [
    "@workspace/towbar-web-ui",
    "@workspace/web-page-sections",
  ],
});

const nextConfig: NextConfig = {
  ...baseConfig,
  async redirects() {
    return [
      ...((await baseConfig.redirects?.()) ?? []),
      {
        source: "/settings/account",
        destination: "/settings?section=account",
        permanent: false,
      },
      {
        source: "/settings/github",
        destination: "/settings?section=github",
        permanent: false,
      },
      {
        source: "/settings/security",
        destination: "/settings?section=security",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
