import Image from "next/image";
import { cn } from "@avgeek-oss/design-system/lib/utils";

export type CloudProviderId =
  | "aws"
  | "gcp"
  | "azure"
  | "oracle"
  | "hetzner"
  | "digitalocean"
  | "linode"
  | "alibaba"
  | "cloudflare"
  | "s3"
  | "r2"
  | "gcs";

function normalizeCloudProvider(provider: CloudProviderId): string {
  switch (provider) {
    case "s3":
    case "aws":
      return "aws";
    case "gcs":
    case "gcp":
      return "gcp";
    case "azure":
      return "azure";
    case "r2":
      return "cloudflare";
    default:
      return provider;
  }
}

export function CloudProviderLogo({
  provider,
  className,
  alt = "",
  size = 16,
}: {
  provider: CloudProviderId;
  className?: string;
  alt?: string;
  size?: number;
}) {
  const normalized = normalizeCloudProvider(provider);
  const variants =
    normalized === "aws"
      ? [
          { name: "aws", visibility: "dark:hidden" },
          { name: "aws-dark", visibility: "hidden dark:block" },
        ]
      : [{ name: normalized, visibility: "" }];

  return (
    <>
      {variants.map((variant) => (
        <Image
          key={variant.name}
          src={`/cloud-providers/${variant.name}.svg`}
          alt={alt}
          aria-hidden={!alt}
          width={size}
          height={size}
          loading="eager"
          decoding="sync"
          unoptimized
          className={cn(
            "size-4 shrink-0 object-contain",
            className,
            variant.visibility,
          )}
        />
      ))}
    </>
  );
}
