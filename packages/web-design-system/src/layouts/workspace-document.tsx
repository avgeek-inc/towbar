import type { ReactNode } from "react";
import { Providers } from "../utilities/providers";
export interface WorkspaceDocumentConfig {
  language?: string;
  scrollbar?: "default" | "overlay";
}
export function WorkspaceDocument({
  children,
  config = {},
}: {
  children: ReactNode;
  config?: WorkspaceDocumentConfig;
}) {
  return (
    <html lang={config.language ?? "en"} suppressHydrationWarning>
      <body className="min-h-dvh max-w-full overflow-x-clip">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
