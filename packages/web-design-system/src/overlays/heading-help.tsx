"use client";

import { createContext, useContext, useState } from "react";
import {
  Button,
  OverlayArrow,
  Popover,
  PreviewTrigger,
} from "react-aria-components";
import { Link } from "@heroui/react";
import { InformationCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { NewTabIndicator } from "../navigation/new-tab-indicator";

export type HeadingDocumentation = {
  description: string;
  href: string;
};
export type HeadingKind = "page" | "widget";
export const HeadingHelpContext = createContext<
  (title: string, kind: HeadingKind) => HeadingDocumentation | undefined
>(() => undefined);

export function HeadingHelp({
  title,
  kind = "widget",
  help,
}: {
  title: string;
  kind?: HeadingKind;
  help?: HeadingDocumentation | false;
}) {
  const resolve = useContext(HeadingHelpContext);
  const [isOpen, setIsOpen] = useState(false);
  const documentation =
    help === false ? undefined : (help ?? resolve(title, kind));
  if (!documentation) return null;
  return (
    <PreviewTrigger
      delay={250}
      closeDelay={100}
      isOpen={isOpen}
      onOpenChange={setIsOpen}
    >
      <Button
        aria-label={`About ${title}`}
        onPress={() => setIsOpen(true)}
        className="relative inline-flex size-6 shrink-0 cursor-pointer touch-manipulation items-center justify-center rounded-full text-muted outline-none pointer-fine:hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus pointer-coarse:before:absolute pointer-coarse:before:-inset-2.5 pointer-coarse:before:content-['']"
      >
        <HugeiconsIcon
          aria-hidden="true"
          icon={InformationCircleIcon}
          className="size-4"
        />
      </Button>
      <Popover
        aria-label={`About ${title}`}
        className="tooltip max-w-64 whitespace-normal break-normal text-xs font-normal [overflow-wrap:normal] [word-break:normal]"
        placement="top"
        offset={7}
      >
        <OverlayArrow>
          <svg
            data-slot="overlay-arrow"
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            aria-hidden="true"
          >
            <path d="M0 0C5.48483 8 6.5 8 12 0Z" />
          </svg>
        </OverlayArrow>
        <span className="grid gap-2">
          <span>{documentation.description}</span>
          <Link
            aria-label={`Open documentation for ${title} in a new tab`}
            href={documentation.href}
            target="_blank"
            rel="noopener noreferrer"
            className="w-fit font-medium !text-foreground !underline decoration-current underline-offset-4"
          >
            <span>
              Open documentation
              <NewTabIndicator />
            </span>
          </Link>
        </span>
      </Popover>
    </PreviewTrigger>
  );
}
