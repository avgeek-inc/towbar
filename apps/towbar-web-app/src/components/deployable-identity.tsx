"use client";

import Image from "next/image";
import { useState } from "react";
import { resourceImageBrand, type ResourceBrand } from "./resource-image-brand";
import {
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

  return (
    <span className="grid min-w-0 justify-items-start gap-0.5">
      <DeployableName
        autoDeploy={Boolean(app.config.autoDeploy)}
        name={app.name}
        href={`/sources/${app.sourceId}/apps/${app.id}`}
        exposed={domains.length > 0}
        health={healthStatus}
      />
      {domains.length > 0 ? (
        <Tooltip>
          <Tooltip.Trigger
            render={(props) => <span {...props} />}
            aria-label={`Domains: ${domains.join(", ")}`}
            className="flex max-w-64 min-w-0 items-center gap-0.5 text-xs text-muted outline-none focus-visible:ring-2 focus-visible:ring-focus rounded-sm"
          >
            <span className="truncate">{domains[0]}</span>
            {domains.length > 1 ? (
              <span className="shrink-0 tabular-nums">
                +{domains.length - 1}
              </span>
            ) : null}
          </Tooltip.Trigger>
          <Tooltip.Content
            className="max-w-xs text-xs"
            placement="top"
            showArrow
          >
            <Tooltip.Arrow />
            <span className="grid gap-1">
              {domains.map((domain) => (
                <span className="break-all" key={domain}>
                  {domain}
                </span>
              ))}
            </span>
          </Tooltip.Content>
        </Tooltip>
      ) : (
        <span className="text-xs text-muted">Not publicly exposed</span>
      )}
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
      <span className="grid min-w-0 gap-0.5">
        <DeployableName
          autoDeploy={Boolean(resource.config.autoDeploy)}
          name={resource.name}
          href={`/sources/${resource.sourceId}/resources/${resource.id}`}
          exposed={Boolean(resource.config.domains?.primary)}
          health={healthStatus}
        />
        <span className="text-xs text-muted">{type.label}</span>
      </span>
    </span>
  );
}

function ResourceLogo({ brand }: { brand: ResourceBrand }) {
  const [failed, setFailed] = useState(false);
  const fallback = "/resource-types/image.png";
  const logo = failed ? fallback : brand.logo;
  const dark = failed ? undefined : brand.logoDark;
  return (
    <span
      className={`inline-flex size-8 shrink-0 items-center justify-center ${brand.darkBackground && !failed ? "rounded-sm bg-zinc-800 p-0.5" : ""} ${brand.darkPlate && !failed ? "rounded-sm dark:bg-white dark:p-0.5" : ""}`}
    >
      <Image
        alt=""
        className={`max-h-full max-w-full size-8 object-contain ${dark ? "dark:hidden" : ""}`}
        height={32}
        width={32}
        src={logo}
        onError={() => setFailed(true)}
      />
      {dark ? (
        <Image
          alt=""
          className="hidden size-8 object-contain dark:block"
          height={32}
          width={32}
          src={dark}
          onError={() => setFailed(true)}
        />
      ) : null}
    </span>
  );
}
