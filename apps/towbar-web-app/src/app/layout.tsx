import type { Metadata, Viewport } from "next";

import "@workspace/web-design-system/styles/globals.css";
import "@workspace/web-page-sections/styles.css";
import { WorkspaceDocument } from "@workspace/web-design-system/layouts/workspace-document";
import { designSystemViewportColors } from "@workspace/web-design-system/lib/design-theme";

import { ApplicationFrame } from "@/components/application-frame";

export const metadata: Metadata = {
  title: { default: "Towbar", template: "%s · Towbar" },
  description: "Deploy Dockerfile applications to your Ubuntu servers.",
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
