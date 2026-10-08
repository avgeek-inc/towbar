import type { Metadata, Viewport } from "next";

import "../../styles.css";
import { WorkspaceDocument } from "@avgeek-oss/design-system/layouts/workspace-document";
import { designSystemViewportColors } from "@avgeek-oss/design-system/lib/design-theme";
import { getTowbarBrandFaviconSource } from "@workspace/towbar-web-ui/brand-assets";

import { ApplicationFrame } from "@/components/application-frame";
import { publicApiOrigin } from "@/lib/public-api-origin";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Towbar", template: "%s · Towbar" },
  description: "Deploy Dockerfile applications to your Ubuntu servers.",
  icons: { icon: getTowbarBrandFaviconSource() },
  robots: { follow: false, index: false },
};

export const viewport: Viewport = { themeColor: designSystemViewportColors };

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <WorkspaceDocument config={{ scrollbar: "overlay" }}>
      <meta
        name="towbar-api-origin"
        content={publicApiOrigin(
          process.env.TOWBAR_API_BASE_URL ?? "http://localhost:4020",
        )}
      />
      <ApplicationFrame>{children}</ApplicationFrame>
    </WorkspaceDocument>
  );
}
