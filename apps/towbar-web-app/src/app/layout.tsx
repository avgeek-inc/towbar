import type { Metadata, Viewport } from "next";

import "../../styles.css";
import { WorkspaceDocument } from "@avgeek-oss/design-system/layouts/workspace-document";
import { designSystemViewportColors } from "@avgeek-oss/design-system/lib/design-theme";
import { getTowbarBrandFaviconSource } from "@workspace/towbar-web-ui/brand-assets";

import { ApplicationFrame } from "@/components/application-frame";

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
      <ApplicationFrame>{children}</ApplicationFrame>
    </WorkspaceDocument>
  );
}
