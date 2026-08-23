"use client";

import { forwardRef, type ComponentPropsWithRef, type ReactNode } from "react";
import { Button } from "../buttons/button";
import { cn } from "../lib/utils";

const Root = forwardRef<HTMLDivElement, ComponentPropsWithRef<"div">>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "overflow-hidden rounded-3xl border border-separator bg-surface",
        className,
      )}
      {...props}
    />
  ),
);
const Header = forwardRef<HTMLDivElement, ComponentPropsWithRef<"div">>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex items-center justify-between border-b border-separator px-4 py-3",
        className,
      )}
      {...props}
    />
  ),
);
function Filename({ className, ...props }: ComponentPropsWithRef<"span">) {
  return (
    <span
      className={cn("truncate text-xs font-medium text-muted", className)}
      {...props}
    />
  );
}
function Code({
  className,
  code,
  ...props
}: Omit<ComponentPropsWithRef<"pre">, "children"> & {
  code: string;
  language?: string;
}) {
  return (
    <pre
      className={cn("m-0 overflow-x-auto p-4 text-sm", className)}
      {...props}
    >
      <code>{code}</code>
    </pre>
  );
}
function CopyButton({ code }: { code: string }) {
  return (
    <Button
      aria-label="Copy code"
      size="sm"
      variant="ghost"
      onPress={() => navigator.clipboard.writeText(code)}
    >
      Copy
    </Button>
  );
}
Root.displayName = "CodeBlock.Root";
Header.displayName = "CodeBlock.Header";
export const CodeBlock = Object.assign(Root, {
  Code,
  CopyButton,
  Filename,
  Header,
  Root,
});
export type CodeBlockProps = ComponentPropsWithRef<typeof Root> & {
  children?: ReactNode;
};
