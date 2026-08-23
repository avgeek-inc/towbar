"use client";

import { Alert } from "@workspace/web-design-system/feedback/alert";
import { Button } from "@workspace/web-design-system/buttons/button";
import { Skeleton } from "@workspace/web-design-system/feedback/skeleton";

export function QueryLoading({
  variant = "detail",
}: {
  variant?: "dashboard" | "detail" | "list" | "table";
}) {
  if (variant === "list") {
    return (
      <div aria-label="Loading list" className="grid gap-2" role="status">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton
            aria-hidden="true"
            className="h-20 w-full rounded-2xl"
            key={index}
          />
        ))}
      </div>
    );
  }
  if (variant === "table") {
    return (
      <Skeleton
        aria-label="Loading table"
        className="h-72 w-full rounded-2xl"
        role="status"
      />
    );
  }

  if (variant === "dashboard") {
    return (
      <div aria-label="Loading dashboard" className="grid gap-8" role="status">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton
              aria-hidden="true"
              className="h-36 w-full rounded-2xl"
              key={index}
            />
          ))}
        </div>
        <Skeleton aria-hidden="true" className="h-72 w-full rounded-2xl" />
        <Skeleton aria-hidden="true" className="h-72 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div aria-label="Loading" className="grid gap-3" role="status">
      <Skeleton aria-hidden="true" className="h-40 w-full rounded-2xl" />
      <Skeleton aria-hidden="true" className="h-64 w-full rounded-2xl" />
    </div>
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
              className="min-h-11"
              size="sm"
              variant="secondary"
              onPress={() => window.dispatchEvent(new Event("towbar:refresh"))}
            >
              Retry
            </Button>
          </div>
        ) : null}
      </Alert.Content>
    </Alert>
  );
}
