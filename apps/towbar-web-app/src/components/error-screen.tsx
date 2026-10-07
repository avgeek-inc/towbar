"use client";
import { ErrorPage } from "@avgeek-oss/design-system/patterns/feedback/error-page";

type ErrorScreenProps = {
  code: "404" | "500";
  title: string;
  description: string;
  onRetry?: () => void;
};
export function ErrorScreen({
  code,
  title,
  description,
  onRetry,
}: ErrorScreenProps) {
  return (
    <ErrorPage
      status={code === "404" ? "not-found" : "server-error"}
      title={title}
      description={description}
      onRetry={onRetry}
      returnHref="/"
      returnLabel="Go to overview"
    />
  );
}
