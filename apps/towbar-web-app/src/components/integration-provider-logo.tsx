import Image from "next/image";
import { cn } from "@workspace/web-design-system/lib/utils";

const providerLogos = {
  github: "/integration-logos/github.svg",
  gitlab: "/integration-logos/gitlab.svg",
  registry: "/resource-logos/docker.webp",
  infisical: "/resource-logos/infisical.webp",
  doppler: "/integration-logos/doppler.ico",
  slack: "/integration-logos/slack.svg",
  discord: "/integration-logos/discord.svg",
  telegram: "/integration-logos/telegram.svg",
  newrelic: "/integration-logos/newrelic.svg",
  axiom: "/integration-logos/axiom.ico",
  betterstack: "/integration-logos/betterstack.png",
  datadog: "/integration-logos/datadog.svg",
  otlp: "/integration-logos/otlp.svg",
  loki: "/integration-logos/loki.svg",
} as const;

const darkProviderLogos: Partial<Record<keyof typeof providerLogos, string>> = {
  newrelic: "/integration-logos/newrelic-dark.svg",
  datadog: "/integration-logos/datadog-dark.svg",
  otlp: "/integration-logos/otlp-dark.svg",
};

export function IntegrationProviderLogo({
  provider,
  className,
  alt = "",
  size = 16,
}: {
  provider: keyof typeof providerLogos;
  className?: string;
  alt?: string;
  size?: number;
}) {
  const darkLogo = darkProviderLogos[provider];
  return (
    <>
      <Image
        src={providerLogos[provider]}
        alt={alt}
        aria-hidden={!alt}
        width={size}
        height={size}
        unoptimized
        className={cn(
          "size-4 shrink-0 object-contain",
          provider === "github" && "dark:invert",
          provider === "axiom" && "rounded-sm bg-black",
          darkLogo && "dark:hidden",
          className,
        )}
      />
      {darkLogo ? (
        <Image
          src={darkLogo}
          alt={alt}
          aria-hidden={!alt}
          width={size}
          height={size}
          unoptimized
          className={cn(
            "hidden size-4 shrink-0 object-contain dark:block",
            className,
          )}
        />
      ) : null}
    </>
  );
}
