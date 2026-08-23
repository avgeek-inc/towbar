import type { ReactNode } from "react";
import { themeBootstrapScript } from "../lib/theme";
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
    <html
      data-theme="light"
      lang={config.language ?? "en"}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: themeBootstrapScript }}
          id="color-scheme-bootstrap"
        />
      </head>
      <body className="min-h-dvh max-w-full overflow-x-clip">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
