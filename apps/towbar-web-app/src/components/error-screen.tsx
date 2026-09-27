"use client";

import Image from "next/image";
import {
  Button,
  ButtonLink,
} from "@workspace/web-design-system/buttons/button";

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
    <section className="grid min-h-[calc(100dvh-10rem)] place-items-center px-4 py-12">
      <div className="flex max-w-md flex-col items-center text-center">
        <Image
          src="/scout/mascot-worried.png"
          width={192}
          height={192}
          alt=""
          className="mb-6 size-40 object-contain sm:size-48"
        />
        <p className="mb-2 font-mono text-xs font-medium tracking-widest text-muted">
          {code}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          {title}
        </h1>
        <p className="mt-3 max-w-sm text-sm leading-6 text-muted">
          {description}
        </p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          {onRetry ? <Button onPress={onRetry}>Try again</Button> : null}
          <ButtonLink href="/" variant={onRetry ? "secondary" : "primary"}>
            Go to overview
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}
