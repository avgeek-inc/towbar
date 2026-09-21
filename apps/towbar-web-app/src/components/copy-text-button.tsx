"use client";
import { useRef, type ReactNode } from "react";
import { Button } from "@workspace/web-design-system/buttons/button";
import { toast } from "@workspace/web-design-system/overlays/toast";

export function CopyTextButton({
  text,
  children,
}: {
  text: string | (() => string);
  children: ReactNode;
}) {
  const copying = useRef(false);
  return (
    <Button
      variant="secondary"
      onPress={async () => {
        if (copying.current) return;
        copying.current = true;
        try {
          await navigator.clipboard.writeText(
            typeof text === "function" ? text() : text,
          );
          toast.success("Link copied");
        } catch {
          toast.danger(
            "Could not copy the link. Check your browser’s clipboard permissions.",
          );
        } finally {
          copying.current = false;
        }
      }}
    >
      {children}
    </Button>
  );
}
