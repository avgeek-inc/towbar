"use client";

import { Copy01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { App } from "@workspace/towbar-web-client";
import { TypographyCode } from "@workspace/web-design-system/typography/typography";
import { ResourceTable } from "@workspace/towbar-web-ui/resource-table";
import {
  TableCellDescription,
  TableCellStack,
} from "@workspace/towbar-web-ui/table-cell-text";

import { getServiceDomains, type ServiceDomain } from "@/lib/service-domains";
import { CopyTextButton } from "./copy-text-button";
import { DomainLink } from "./domain-link";

const tlsLabels: Record<ServiceDomain["tls"], string> = {
  direct: "Direct",
  "cloudflare-dns": "Cloudflare DNS",
  "cloudflare-tunnel": "Cloudflare edge",
};

export function ServiceDomains({ config }: { config: App["config"] }) {
  return (
    <ResourceTable
      ariaLabel="Service domains"
      items={getServiceDomains(config)}
      getRowKey={(row) => row.hostname}
      emptyTitle="No domains configured"
      emptyDescription="Declare domains in this service’s manifest, then sync the repository to see them here."
      columns={[
        {
          key: "domain",
          header: "Domain",
          cell: (row) => (
            <TableCellStack as="div">
              <DomainLink className="max-w-80" domain={row.hostname}>
                {row.hostname}
              </DomainLink>
              {row.role ? (
                <TableCellDescription>{row.role} domain</TableCellDescription>
              ) : null}
            </TableCellStack>
          ),
        },
        {
          key: "target",
          header: "Routes to",
          cell: (row) => (
            <TableCellStack as="div">
              {row.target.kind === "redirect" ? (
                <>
                  <DomainLink className="max-w-80" domain={row.target.hostname}>
                    {row.target.hostname}
                  </DomainLink>
                  <TableCellDescription>
                    <span
                      className={
                        row.target.status === 301
                          ? "font-mono tabular-nums text-yellow-700 dark:text-yellow-400"
                          : "font-mono tabular-nums text-orange-700 dark:text-orange-400"
                      }
                    >
                      {row.target.status}
                    </span>{" "}
                    · {row.target.status === 301 ? "Permanent" : "Temporary"}{" "}
                    redirect
                  </TableCellDescription>
                </>
              ) : (
                <>
                  {row.target.kind === "compose" ? (
                    <TypographyCode>{row.target.name}</TypographyCode>
                  ) : (
                    row.target.name
                  )}
                  <TableCellDescription>
                    Port {row.target.port} ·{" "}
                    {row.target.ingress === "cloudflare-tunnel"
                      ? "Cloudflare Tunnel"
                      : "Proxy"}
                  </TableCellDescription>
                </>
              )}
            </TableCellStack>
          ),
        },
        {
          key: "tls",
          header: "TLS",
          cell: (row) => (
            <span className="whitespace-nowrap">{tlsLabels[row.tls]}</span>
          ),
        },
        {
          key: "actions",
          header: "",
          className: "text-right",
          cell: (row) => (
            <CopyTextButton text={`https://${row.hostname}`}>
              <HugeiconsIcon icon={Copy01Icon} aria-hidden="true" />
              Copy link
              <span className="sr-only"> for {row.hostname}</span>
            </CopyTextButton>
          ),
        },
      ]}
      footer="Update the service manifest and sync the repository to change these routes."
    />
  );
}
