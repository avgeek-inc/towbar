"use client";

import { HugeiconsIcon } from "@hugeicons/react";

import { Settings01Icon } from "@hugeicons/core-free-icons";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

import type { Server } from "@workspace/towbar-web-client";
import { Button } from "@workspace/web-design-system/buttons/button";
import { Field, FieldLabel } from "@workspace/web-design-system/forms/field";
import { Input } from "@workspace/web-design-system/forms/input";
import { toast } from "@workspace/web-design-system/overlays/toast";

import { FormCard } from "@/components/page-parts";
import { refreshApiQueries } from "@/hooks/use-api-query";
import { api } from "@/lib/api";
import { ServerCredentials } from "./credential-editor";

export function ServerEditor({
  canManage = true,
  server,
}: {
  canManage?: boolean;
  server?: Server;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const editing = Boolean(server);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const values = new FormData(event.currentTarget);
    const ip = editing
      ? server!.canonicalIp
      : String(values.get("ip") ?? "").trim();
    const host = editing
      ? (server!.config.ssh.host ?? server!.canonicalIp)
      : String(values.get("sshHost") ?? "").trim();
    const config = {
      buildConcurrency: Number(values.get("buildConcurrency")),
      previewBuildConcurrency: Number(values.get("previewBuildConcurrency")),
      ip,
      ssh: {
        ...(host && host !== ip ? { host } : {}),
        port: Number(values.get("sshPort")),
        username: String(values.get("sshUsername") ?? "").trim(),
      },
      ...(server?.config.proxy?.cloudflare.enabled
        ? { proxy: { cloudflare: { enabled: true as const } } }
        : {}),
    };
    try {
      const response = editing
        ? await api.patch<{ server: Server }>(
            `/v1/core/servers/${server!.id}`,
            config,
          )
        : await api.post<{ server: Server }>("/v1/core/servers", config);
      toast.success(editing ? "Server settings saved" : "Server added");
      refreshApiQueries();
      if (!editing)
        router.push(`/servers/${response.server.id}?section=settings`);
    } catch (error) {
      toast.danger(editing ? "Couldn't save server" : "Couldn't add server", {
        description:
          error instanceof Error ? error.message : "The request failed",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-8">
      <FormCard
        icon={<HugeiconsIcon icon={Settings01Icon} />}
        title={editing ? "Server configuration" : "Connection and scheduling"}
      >
        <form className="grid gap-5" onSubmit={save}>
          <div className="content-grid grid-cols-2 lg:grid-cols-4">
            {!editing ? (
              <>
                <Field>
                  <FieldLabel htmlFor="server-ip">IP address</FieldLabel>
                  <Input
                    id="server-ip"
                    disabled={!canManage}
                    name="ip"
                    placeholder="203.0.113.10"
                    required
                    variant="secondary"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="server-ssh-host">SSH host</FieldLabel>
                  <Input
                    id="server-ssh-host"
                    disabled={!canManage}
                    name="sshHost"
                    placeholder="Defaults to the IP address"
                    variant="secondary"
                  />
                </Field>
              </>
            ) : null}
            <Field>
              <FieldLabel htmlFor="server-ssh-username">
                SSH username
              </FieldLabel>
              <Input
                id="server-ssh-username"
                defaultValue={server?.config.ssh.username ?? "deploy"}
                disabled={!canManage}
                name="sshUsername"
                placeholder="deploy"
                required
                variant="secondary"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="server-ssh-port">SSH port</FieldLabel>
              <Input
                id="server-ssh-port"
                defaultValue={String(server?.config.ssh.port ?? 22)}
                disabled={!canManage}
                max={65_535}
                min={1}
                name="sshPort"
                required
                type="number"
                variant="secondary"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="server-build-concurrency">
                Concurrent builds
              </FieldLabel>
              <Input
                id="server-build-concurrency"
                defaultValue={String(server?.config.buildConcurrency ?? 1)}
                disabled={!canManage}
                max={16}
                min={1}
                name="buildConcurrency"
                required
                type="number"
                variant="secondary"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="server-preview-concurrency">
                Concurrent preview builds
              </FieldLabel>
              <Input
                id="server-preview-concurrency"
                defaultValue={String(
                  server?.config.previewBuildConcurrency ?? 1,
                )}
                disabled={!canManage}
                max={4}
                min={1}
                name="previewBuildConcurrency"
                required
                type="number"
                variant="secondary"
              />
            </Field>
          </div>
          <Button
            className="w-fit"
            isDisabled={busy || !canManage}
            type="submit"
          >
            {busy ? "Saving…" : editing ? "Save" : "Add server"}
          </Button>
        </form>
      </FormCard>
      {server ? (
        <ServerCredentials canManage={canManage} server={server} />
      ) : null}
    </div>
  );
}
