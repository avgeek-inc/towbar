import type { Metadata, Viewport } from "next";
import "@workspace/web-design-system/styles/globals.css";
import "@workspace/identity-web-ui/styles.css";
import { WorkspaceDocument } from "@workspace/web-design-system/layouts/workspace-document";
import { designSystemViewportColors } from "@workspace/web-design-system/lib/design-theme";

import { ApplicationRuntime } from "@/components/application-runtime";

export const metadata: Metadata = {
  title: "Sign in · Towbar",
  description: "Private access to Towbar.",
  robots: { follow: false, index: false },
};
export const viewport: Viewport = { themeColor: designSystemViewportColors };
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <WorkspaceDocument>
      <ApplicationRuntime>{children}</ApplicationRuntime>
    </WorkspaceDocument>
  );
}
