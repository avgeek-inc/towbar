import {
  InlineExternalLink,
  type InlineExternalLinkProps,
} from "@avgeek-oss/design-system/navigation/inline-external-link";

export function DomainLink({
  children,
  domain,
  target = "_blank",
  title = domain,
  showTooltip = true,
  ...props
}: Omit<InlineExternalLinkProps, "href" | "tooltip"> & {
  domain: string;
  showTooltip?: boolean;
}) {
  return (
    <InlineExternalLink
      href={`https://${domain}`}
      target={target}
      tooltip={showTooltip ? title : undefined}
      aria-label={
        typeof children === "string" && children !== domain
          ? `${domain}${target === "_blank" ? " (opens in a new tab)" : ""}`
          : undefined
      }
      {...props}
    >
      {children}
    </InlineExternalLink>
  );
}
