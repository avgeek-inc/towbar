"use client";

import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithRef,
  type ReactNode,
} from "react";
import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, type ButtonProps } from "../buttons/button";
import { Widget } from "../data-display/widget";
import { cn } from "../lib/utils";

const Root = forwardRef<HTMLDivElement, ComponentPropsWithRef<"div">>(
  ({ className, ...props }, ref) => (
    <Widget
      ref={ref}
      className={cn("min-w-0", className)}
      data-slot="code-block"
      {...props}
    />
  ),
);

const Header = forwardRef<HTMLDivElement, ComponentPropsWithRef<"div">>(
  ({ children, className, ...props }, ref) => (
    <Widget.Header
      ref={ref}
      className={className}
      data-slot="code-block-header"
      {...props}
    >
      {children}
    </Widget.Header>
  ),
);

const Filename = forwardRef<HTMLSpanElement, ComponentPropsWithRef<"span">>(
  ({ className, ...props }, ref) => (
    <Widget.Title
      ref={ref}
      className={cn("min-w-0 truncate text-muted", className)}
      data-slot="code-block-filename"
      {...props}
    />
  ),
);

const Code = forwardRef<
  HTMLPreElement,
  Omit<ComponentPropsWithRef<"pre">, "children"> & {
    code: string;
    language?: string;
  }
>(({ className, code, language, ...props }, ref) => (
  <Widget.Content className="p-0">
    <pre
      ref={ref}
      className={cn("m-0 overflow-x-auto p-4 text-sm", className)}
      data-language={language}
      data-slot="code-block-code"
      {...props}
    >
      <code>{code}</code>
    </pre>
  </Widget.Content>
));

type CopyButtonProps = Omit<ButtonProps, "children" | "onPress"> & {
  code: string;
};

const CopyButton = forwardRef<HTMLButtonElement, CopyButtonProps>(
  ({ code, ...props }, ref) => {
    const [copied, setCopied] = useState(false);
    const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(
      () => () => {
        if (resetTimer.current) clearTimeout(resetTimer.current);
      },
      [],
    );

    const copyCode = async () => {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(false), 1800);
    };

    const label = copied ? "Code copied" : "Copy code";
    return (
      <Button
        {...props}
        ref={ref}
        aria-label={props["aria-label"] ?? label}
        data-slot="code-block-copy"
        isIconOnly
        onPress={copyCode}
        size={props.size ?? "sm"}
        variant={props.variant ?? "ghost"}
      >
        <HugeiconsIcon
          aria-hidden="true"
          icon={copied ? Tick02Icon : Copy01Icon}
          size={16}
        />
      </Button>
    );
  },
);

Root.displayName = "CodeBlock.Root";
Header.displayName = "CodeBlock.Header";
Filename.displayName = "CodeBlock.Filename";
Code.displayName = "CodeBlock.Code";
CopyButton.displayName = "CodeBlock.CopyButton";

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
