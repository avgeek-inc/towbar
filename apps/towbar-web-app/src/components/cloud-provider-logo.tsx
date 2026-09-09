import Image from "next/image";
import { cn } from "@workspace/web-design-system/lib/utils";

export type CloudProviderId =
  | "aws"
  | "gcp"
  | "azure"
  | "s3"
  | "gcs"
  | "azureBlob"
  | string;

export function normalizeCloudProvider(provider: CloudProviderId): string {
  switch (provider) {
    case "s3":
    case "aws":
      return "aws";
    case "gcs":
    case "gcp":
      return "gcp";
    case "azureBlob":
    case "azure":
      return "azure";
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
      unoptimized
      className={cn("size-4 shrink-0 object-contain", className)}
    />
  );
}
