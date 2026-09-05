"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

import type { Server } from "@workspace/towbar-web-client";
import { Button } from "@workspace/web-design-system/buttons/button";
import { Field, FieldLabel } from "@workspace/web-design-system/forms/field";
import { Input } from "@workspace/web-design-system/forms/input";
import { Label } from "@workspace/web-design-system/forms/label";
import { Switch } from "@workspace/web-design-system/forms/switch";
import { toast } from "@workspace/web-design-system/overlays/toast";

import { ActionButton, FormCard } from "@/components/page-parts";
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
  const [cloudflareEnabled, setCloudflareEnabled] = useState(
    Boolean(server?.config.proxy?.cloudflare.enabled),
  );
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
      ...(cloudflareEnabled
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
        title={editing ? "Server configuration" : "Connection and scheduling"}
      >
        <form className="grid max-w-2xl gap-5" onSubmit={save}>
          <div className="grid gap-5 sm:grid-cols-2">
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
          <Switch
            isDisabled={!canManage}
            isSelected={cloudflareEnabled}
            onChange={setCloudflareEnabled}
          >
            <Switch.Content className="min-h-11">
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
              <span className="grid gap-1">
                <Label>Enable Cloudflare DNS TLS</Label>
                <span className="text-sm text-muted">
                  Enable this when a workload on this server uses Cloudflare DNS
                  TLS.
                </span>
              </span>
            </Switch.Content>
          </Switch>
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
        <ServerCredentials
          cloudflareEnabled={cloudflareEnabled}
          serverId={server.id}
        />
      ) : null}
    </div>
  );
}

export function ServerRemoval({ server }: { server: Server }) {
  const router = useRouter();
  return (
    <FormCard title="Remove server">
      <ActionButton
        action={() => api.delete(`/v1/core/servers/${server.id}`)}
        confirm={{
          actionLabel: "Remove server",
          description:
            "Towbar will archive this server and retain its saved credentials. Add the same IP again to restore its configuration.",
          title: `Remove ${server.canonicalIp}?`,
        }}
        onSuccess={() => router.push("/servers")}
        pendingLabel="Removing…"
        success="Server removed"
        variant="danger"
      >
        Remove server
      </ActionButton>
    </FormCard>
  );
}
