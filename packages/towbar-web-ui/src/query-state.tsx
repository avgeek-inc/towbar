"use client";
import { HugeiconsIcon } from "@hugeicons/react";
import { ReloadIcon } from "@hugeicons/core-free-icons";

import { Alert } from "@avgeek-oss/design-system/feedback/alert";
import { Button } from "@avgeek-oss/design-system/buttons/button";

export function QueryLoading({
  variant = "detail",
}: {
  variant?: "dashboard" | "detail" | "list" | "table";
}) {
  return (
    <span className="sr-only" role="status">
      {variant === "detail" ? "Loading" : `Loading ${variant}`}
    </span>
  );
}

export function QueryError({
  message,
  retryable = true,
}: {
  message: string;
  retryable?: boolean;
}) {
  return (
    <Alert status="danger">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>Couldn&apos;t load this view</Alert.Title>
        <Alert.Description>{message}</Alert.Description>
        {retryable ? (
          <div className="mt-3">
            <Button
              variant="secondary"
              onPress={() => window.dispatchEvent(new Event("towbar:refresh"))}
            >
              <HugeiconsIcon
                aria-hidden="true"
                icon={ReloadIcon}
                className="size-4 shrink-0"
              />
              Retry
            </Button>
          </div>
        ) : null}
      </Alert.Content>
    </Alert>
  );
}
