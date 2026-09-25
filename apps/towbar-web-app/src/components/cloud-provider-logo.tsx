import Image from "next/image";
import { cn } from "@workspace/web-design-system/lib/utils";

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

  return (
    <Image
      src={`/cloud-providers/${normalized}.svg`}
      alt={alt}
      aria-hidden={!alt}
      width={size}
      height={size}
      loading="eager"
      decoding="sync"
      unoptimized
      className={cn("size-4 shrink-0 object-contain", className)}
    />
  );
}
