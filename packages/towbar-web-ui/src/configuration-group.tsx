"use client";

import type { ReactNode } from "react";
import { useState } from "react";

import { Button } from "@workspace/web-design-system/buttons/button";
import { Disclosure } from "@workspace/web-design-system/navigation/disclosure";

export function ConfigurationGroup({
  children,
  defaultExpanded = false,
  description,
  title,
}: {
  children: ReactNode;
  defaultExpanded?: boolean;
  description?: string;
  title: string;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  return (
    <Disclosure isExpanded={expanded} onExpandedChange={setExpanded}>
      <Disclosure.Heading>
        <Button
          className="min-h-14 w-full justify-between text-start"
          slot="trigger"
          variant="secondary"
        >
          <span className="grid min-w-0 gap-0.5">
            <span className="typography--body-sm font-medium">{title}</span>
            {description ? (
              <span className="text-muted typography--body-xs font-normal">
                {description}
              </span>
            ) : null}
          </span>
          <Disclosure.Indicator />
        </Button>
      </Disclosure.Heading>
      <Disclosure.Content>
        <Disclosure.Body className="pt-3">{children}</Disclosure.Body>
      </Disclosure.Content>
    </Disclosure>
  );
}
