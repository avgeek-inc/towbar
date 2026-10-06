"use client";

import { FloppyDiskIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Server } from "@workspace/towbar-web-client";
import { Button } from "@avgeek-oss/design-system/buttons/button";
import { Checkbox } from "@avgeek-oss/design-system/forms/checkbox";
import { FieldDescription } from "@avgeek-oss/design-system/forms/field";
import { Label } from "@avgeek-oss/design-system/forms/label";
import { toast } from "@avgeek-oss/design-system/overlays/toast";
import { useState, type FormEvent } from "react";

import { FormCard } from "@/components/page-parts";
import { refreshApiQueries } from "@/hooks/use-api-query";
import { api } from "@/lib/api";

export function ServerLogCollection({
  canManage,
  server,
}: {
  canManage: boolean;
  server: Server;
}) {
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !canManage) return;
    const values = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await api.patch(`/v1/core/servers/${server.id}`, {
        ...server.config,
        hostLogCollection: values.get("hostLogCollection") === "on",
      });
      toast.success("Logs collection settings saved");
      refreshApiQueries();
    } catch (error) {
      toast.danger("Couldn't save logs collection", {
        description:
          error instanceof Error ? error.message : "The request failed",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormCard title="Docker logs">
      <form className="content-grid" onSubmit={save}>
        <div className="grid gap-2">
          <Checkbox
            aria-describedby="server-host-log-description"
            className="w-fit"
            name="hostLogCollection"
            value="on"
            defaultSelected={server.config.hostLogCollection === true}
            isDisabled={busy || !canManage}
            variant="secondary"
          >
            <Checkbox.Content className="min-h-8">
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
              <Label>Allow Docker log collection</Label>
            </Checkbox.Content>
          </Checkbox>
          <FieldDescription
            className="max-w-prose"
            id="server-host-log-description"
          >
            Allow trusted collector Services to read this server’s Docker logs
            and container metadata. The Service must explicitly request access.
            Disabling this setting blocks future collector deployments; stop
            existing collectors to remove their access.
          </FieldDescription>
        </div>
        <Button className="w-fit" isDisabled={busy || !canManage} type="submit">
          <HugeiconsIcon
            aria-hidden="true"
            icon={FloppyDiskIcon}
            className="size-4 shrink-0"
          />
          {busy ? "Saving…" : "Save"}
        </Button>
      </form>
    </FormCard>
  );
}
