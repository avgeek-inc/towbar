"use client";

import {
  DashboardCircleIcon,
  CubeIcon,
  ServerStack01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useRouter } from "next/navigation";

import type { App, Resource, Server } from "@workspace/towbar-web-client";
import { ListBox, Select } from "@workspace/web-design-system/forms/select";
import {
  Autocomplete,
  SearchField,
} from "@workspace/web-design-system/pickers/autocomplete";

import { useApiQuery } from "@/hooks/use-api-query";
import { groupDeployableInstances } from "@/lib/deployable-groups";
import { AppLogo, ResourceLogo } from "./deployable-identity";
import { CloudProviderLogo, type CloudProviderId } from "./cloud-provider-logo";
import { resourceImageBrand, type ResourceBrand } from "./resource-image-brand";

export type BreadcrumbEntityKind = "apps" | "resources" | "servers";

const entityLabels = {
  apps: "apps",
  resources: "resources",
  servers: "servers",
} as const;

const entityIcons = {
  apps: DashboardCircleIcon,
  resources: CubeIcon,
  servers: ServerStack01Icon,
} as const;

type SwitchOption = {
  archived: boolean;
  id: string;
  identity?:
    | { kind: "app"; domain: string | undefined }
    | { kind: "resource"; brand: ResourceBrand }
    | { kind: "server"; provider: CloudProviderId };
  instanceIds: string[];
  label: string;
};

function deployableOptions<T extends App | Resource>(
  items: T[],
  identity: (item: T) => SwitchOption["identity"],
): SwitchOption[] {
  return groupDeployableInstances(items).map((group) => {
    const preferred =
      group.items.find(
        (item) => item.environment?.name.toLowerCase() === "production",
      ) ??
      group.items.find((item) => !item.archivedAt) ??
      group.items[0]!;
    return {
      archived: group.items.every((item) => Boolean(item.archivedAt)),
      id: preferred.id,
      identity: identity(preferred),
      instanceIds: group.items.map((item) => item.id),
      label: preferred.name,
    };
  });
}

export function BreadcrumbEntitySwitcher({
  currentId,
  kind,
  label,
}: {
  currentId: string;
  kind: BreadcrumbEntityKind;
  label: string;
}) {
  const router = useRouter();
  const query = useApiQuery<{
    apps?: App[];
    resources?: Resource[];
    servers?: Server[];
  }>(`/v1/core/${kind}`, 30_000);
  const options: SwitchOption[] = (
    kind === "servers"
      ? (query.data?.servers ?? []).map((server) => ({
          archived: Boolean(server.archivedAt),
          id: server.id,
          identity: server.hardware?.instance
            ? {
                kind: "server" as const,
                provider: server.hardware.instance.provider,
              }
            : undefined,
          instanceIds: [server.id],
          label: server.canonicalIp,
        }))
      : kind === "apps"
        ? deployableOptions(query.data?.apps ?? [], (app) => ({
            kind: "app",
            domain:
              app.config.domains?.primary ??
              app.config.domains?.redirects[0]?.host,
          }))
        : deployableOptions(query.data?.resources ?? [], (resource) => ({
            kind: "resource",
            brand: resourceImageBrand(resource.kind, resource.config.image),
          }))
  ).sort((left, right) => left.label.localeCompare(right.label));
  if (!options.some((option) => option.instanceIds.includes(currentId))) {
    options.unshift({
      id: currentId,
      instanceIds: [currentId],
      label,
      archived: false,
    });
  }
  const entityLabel = entityLabels[kind];
  const icon = entityIcons[kind];

  return (
    <Select
      aria-label={`Switch ${entityLabel.slice(0, -1)}`}
      selectedKey={currentId}
      onSelectionChange={(key) => {
        const id = String(key ?? "");
        if (id !== currentId && options.some((option) => option.id === id)) {
          router.push(`/${kind}/${id}/overview`);
        }
      }}
    >
      <Select.Trigger className="h-auto! min-h-0! max-w-40 gap-1 rounded-sm! border-0! bg-transparent! px-0! py-0! text-sm font-medium text-foreground shadow-none! hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:max-w-64">
        <Select.Value className="min-w-0 truncate">{label}</Select.Value>
        <Select.Indicator className="static! size-3 shrink-0 text-muted" />
      </Select.Trigger>
      <Select.Popover className="w-72 max-w-[calc(100vw-2rem)] overflow-hidden">
        <Autocomplete.Filter
          filter={(text, search) =>
            text.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
          }
        >
          <SearchField
            aria-label={`Search ${entityLabel}`}
            className="px-2 pt-2"
            variant="secondary"
          >
            <SearchField.Group className="rounded-[5px]">
              <SearchField.SearchIcon />
              <SearchField.Input
                className="text-base sm:text-sm"
                placeholder={`Search ${entityLabel}…`}
                maxLength={200}
                autoComplete="off"
                spellCheck={false}
                autoFocus={
                  typeof window !== "undefined" &&
                  window.matchMedia("(pointer: fine)").matches
                }
              />
              <SearchField.ClearButton
                aria-label={`Clear ${entityLabel} search`}
              />
            </SearchField.Group>
          </SearchField>
          {query.error ? (
            <p className="px-3 py-2 text-xs text-danger">{query.error}</p>
          ) : !query.data ? (
            <p className="px-3 py-2 text-xs text-muted">
              Loading {entityLabel}…
            </p>
          ) : null}
          <ListBox
            className="max-h-80 overflow-y-auto"
            renderEmptyState={() => (
              <p className="px-3 py-4 text-sm text-muted">
                {query.error ?? `No matching ${entityLabel}.`}
              </p>
            )}
          >
            {options.map((option) => (
              <ListBox.Item
                id={option.id}
                key={option.id}
                textValue={option.label}
              >
                {option.identity?.kind === "app" ? (
                  <AppLogo domain={option.identity.domain} size="compact" />
                ) : option.identity?.kind === "resource" ? (
                  <ResourceLogo brand={option.identity.brand} size="compact" />
                ) : option.identity?.kind === "server" ? (
                  <CloudProviderLogo
                    provider={option.identity.provider}
                    className="size-4"
                    size={16}
                  />
                ) : (
                  <HugeiconsIcon
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted"
                    icon={icon}
                  />
                )}
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.archived ? (
                  <span className="text-xs text-muted">Archived</span>
                ) : null}
                <ListBox.ItemIndicator />
              </ListBox.Item>
            ))}
          </ListBox>
        </Autocomplete.Filter>
      </Select.Popover>
    </Select>
  );
}
