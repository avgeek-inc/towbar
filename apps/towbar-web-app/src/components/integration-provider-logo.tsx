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
} as const;

const darkProviderLogos: Partial<Record<keyof typeof providerLogos, string>> =
  {};

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
        loading="eager"
        decoding="sync"
        unoptimized
        className={cn(
          "size-4 shrink-0 object-contain",
          provider === "github" && "dark:invert",
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
          loading="eager"
          decoding="sync"
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
