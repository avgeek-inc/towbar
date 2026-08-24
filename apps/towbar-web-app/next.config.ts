import { createNextConfig } from "@workspace/web-design-system/lib/next-config";
import type { NextConfig } from "next";

const baseConfig = createNextConfig((config) => config, {
  sentryProject: "towbar-web-app",
  transpilePackages: [
    "@workspace/identity-web-ui",
    "@workspace/towbar-web-ui",
    "@workspace/web-page-sections",
  ],
});

const nextConfig: NextConfig = {
  ...baseConfig,
  agentRules: false,
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
