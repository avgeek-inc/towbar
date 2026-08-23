import { createNextConfig } from "@workspace/web-design-system/lib/next-config";

export default createNextConfig((config) => config, {
  sentryProject: "towbar-sso",
  transpilePackages: [
    "@workspace/identity-web-ui",
    "@workspace/towbar-web-ui",
    "@workspace/web-page-sections",
  ],
});
