"use client";

import {
  TableCellStack,
  TableCellDescription,
  tableCellDescriptionClassName,
} from "@workspace/towbar-web-ui/table-cell-text";

import Image, { type ImageLoaderProps } from "next/image";
import { useState } from "react";
import { resourceImageBrand, type ResourceBrand } from "./resource-image-brand";
import {
  DashboardCircleIcon,
  HeartPulseIcon,
  InternetIcon,
  WebhookIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { App, Resource } from "@workspace/towbar-web-client";
import {
  Tooltip,
  TooltipText,
} from "@workspace/web-design-system/overlays/tooltip";
import { InlineLink } from "./page-parts";
import { DomainLink } from "./domain-link";

function externalImageLoader({ src }: ImageLoaderProps) {
  return src;
}

const loadedAppLogoDomains = new Set<string>();
const failedAppLogoDomains = new Set<string>();

export function AppIdentity({
  app,
  healthStatus = app.runtimeState.healthStatus,
}: {
  app: App;
  healthStatus?: App["runtimeState"]["healthStatus"];
}) {
  const domains = [
    ...new Set(
      [
        app.config.domains?.primary,
        ...(app.config.domains?.redirects.map(({ host }) => host) ?? []),
      ].filter((domain): domain is string => Boolean(domain)),
    ),
  ];
  const primaryDomain = domains[0];

  return (
    <span className="inline-flex min-w-0 items-center gap-3">
      <AppLogo key={primaryDomain ?? "no-domain"} domain={primaryDomain} />
      <TableCellStack className="justify-items-start">
        <DeployableName
          autoDeploy={Boolean(app.config.autoDeploy)}
          name={app.name}
          href={`/apps/${app.id}`}
          exposed={domains.length > 0}
          health={healthStatus}
        />
        {primaryDomain && domains.length === 1 ? (
          <TooltipText
            className={`${tableCellDescriptionClassName} flex max-w-64 min-w-0 items-center gap-0.5 truncate`}
            tooltip={primaryDomain}
          >
            <DomainLink
              className="truncate"
              domain={primaryDomain}
              showTooltip={false}
            >
              {primaryDomain}
            </DomainLink>
          </TooltipText>
        ) : primaryDomain ? (
          <Tooltip>
            <Tooltip.Trigger
              render={(props) => <span {...props} />}
              aria-label={`Domains: ${domains.join(", ")}`}
              className={`${tableCellDescriptionClassName} flex max-w-64 min-w-0 items-center gap-0.5 outline-none focus-visible:ring-2 focus-visible:ring-focus rounded-sm`}
            >
              <DomainLink
                className="truncate"
                domain={primaryDomain}
                showTooltip={false}
              >
                {primaryDomain}
              </DomainLink>
              {domains.length > 1 ? (
                <span className="shrink-0 tabular-nums">
                  +{domains.length - 1}
                </span>
              ) : null}
            </Tooltip.Trigger>
            <Tooltip.Content
              className="max-w-64 whitespace-normal break-normal text-xs [overflow-wrap:normal] [word-break:normal]"
              placement="top"
              showArrow
            >
              <Tooltip.Arrow />
              <span className="grid gap-1">
                {domains.map((domain) => (
                  <DomainLink
                    className="whitespace-nowrap"
                    domain={domain}
                    key={domain}
                    showTooltip={false}
                  >
                    {domain}
                  </DomainLink>
                ))}
              </span>
            </Tooltip.Content>
          </Tooltip>
        ) : (
          <TableCellDescription>Not publicly exposed</TableCellDescription>
        )}
      </TableCellStack>
    </span>
  );
}

export function AppLogo({
  domain,
  size = "default",
}: {
  domain: string | undefined;
  size?: "default" | "small";
}) {
  const [result, setResult] = useState<{
    domain: string;
    status: "failed" | "loaded";
  }>();
  const loaded = Boolean(
    domain &&
    (loadedAppLogoDomains.has(domain) ||
      (result?.domain === domain && result.status === "loaded")),
  );
  const failed = Boolean(
    domain &&
    (failedAppLogoDomains.has(domain) ||
      (result?.domain === domain && result.status === "failed")),
  );
  const pixels = size === "small" ? 24 : 32;
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-sm ${size === "small" ? "size-6" : "size-8"}`}
    >
      {!loaded ? (
        <HugeiconsIcon
          aria-hidden="true"
          className={size === "small" ? "size-5" : "size-6"}
          icon={DashboardCircleIcon}
        />
      ) : null}
      {domain && !failed ? (
        <Image
          alt=""
          className={`object-contain ${size === "small" ? "size-6" : "size-8"} ${loaded ? "" : "absolute opacity-0"}`}
          height={pixels}
          loader={externalImageLoader}
          loading="eager"
          decoding="sync"
          unoptimized
          width={pixels}
          src={`https://${domain}/favicon.ico`}
          onError={() => {
            failedAppLogoDomains.add(domain);
            setResult({ domain, status: "failed" });
          }}
          onLoad={(event) => {
            const image = event.currentTarget;
            if (image.naturalWidth > 0 && image.naturalHeight > 0) {
              loadedAppLogoDomains.add(domain);
              setResult({ domain, status: "loaded" });
            } else {
              failedAppLogoDomains.add(domain);
              setResult({ domain, status: "failed" });
            }
          }}
          referrerPolicy="no-referrer"
        />
      ) : null}
    </span>
  );
}

function DeployableName({
  autoDeploy,
  name,
  href,
  exposed,
  health,
}: {
  autoDeploy: boolean;
  name: string;
  href: string;
  exposed: boolean;
  health: App["runtimeState"]["healthStatus"];
}) {
  const indicators = [
    {
      icon: WebhookIcon,
      positive: autoDeploy,
      label: autoDeploy ? "Auto-deploy enabled" : "Auto-deploy disabled",
    },
    {
      icon: InternetIcon,
      positive: exposed,
      label: exposed
        ? "Publicly exposed to the internet"
        : "Not publicly exposed",
    },
    {
      icon: HeartPulseIcon,
      positive: health === "healthy",
      label: {
        healthy: "Healthy",
        unhealthy: "Unhealthy",
        starting: "Health check starting",
        unknown: "Health unknown",
        none: "No health status reported",
      }[health],
    },
  ];
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <InlineLink className="min-w-0" href={href}>
        <TooltipText className="block truncate" tabIndex={-1} tooltip={name}>
          {name}
        </TooltipText>
      </InlineLink>
      <span className="inline-flex shrink-0 items-center gap-0.5">
        {indicators.map(({ icon, positive, label }) => (
          <TooltipText
            key={label}
            aria-label={label}
            tooltip={label}
            className={`inline-flex size-5 shrink-0 items-center justify-center leading-none ${positive ? "text-success-soft-foreground" : "text-danger-soft-foreground"}`}
            role="img"
          >
            <HugeiconsIcon aria-hidden="true" className="size-4" icon={icon} />
          </TooltipText>
        ))}
      </span>
    </span>
  );
}

export function ResourceIdentity({
  resource,
  healthStatus = resource.runtimeState.healthStatus,
}: {
  resource: Resource;
  healthStatus?: Resource["runtimeState"]["healthStatus"];
}) {
  const type = resourceImageBrand(resource.kind, resource.config.image);
  return (
    <span className="inline-flex min-w-0 items-center gap-3">
      <ResourceLogo key={type.logo} brand={type} />
      <TableCellStack>
        <DeployableName
          autoDeploy={Boolean(resource.config.autoDeploy)}
          name={resource.name}
          href={`/resources/${resource.id}`}
          exposed={Boolean(resource.config.domains?.primary)}
          health={healthStatus}
        />
        <TableCellDescription>{type.label}</TableCellDescription>
      </TableCellStack>
    </span>
  );
}

export function ResourceLogo({
  brand,
  size = "default",
}: {
  brand: ResourceBrand;
  size?: "default" | "small";
}) {
  const [failed, setFailed] = useState(false);
  const fallback = "/resource-types/image.png";
  const logo = failed ? fallback : brand.logo;
  const dark = failed ? undefined : brand.logoDark;
  const pixels = size === "small" ? 24 : 32;
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center ${size === "small" ? "size-6" : "size-8"} ${brand.darkBackground && !failed ? "rounded-sm bg-zinc-800 p-0.5" : ""} ${brand.darkPlate && !failed ? "rounded-sm dark:bg-white dark:p-0.5" : ""}`}
    >
      <Image
        alt=""
        className={`max-h-full max-w-full object-contain ${size === "small" ? "size-6" : "size-8"} ${dark ? "dark:hidden" : ""}`}
        height={pixels}
        width={pixels}
        src={logo}
        loading="eager"
        decoding="sync"
        unoptimized
        onError={() => setFailed(true)}
      />
      {dark ? (
        <Image
          alt=""
          className={`hidden object-contain dark:block ${size === "small" ? "size-6" : "size-8"}`}
          height={pixels}
          width={pixels}
          src={dark}
          loading="eager"
          decoding="sync"
          unoptimized
          onError={() => setFailed(true)}
        />
      ) : null}
    </span>
  );
}
