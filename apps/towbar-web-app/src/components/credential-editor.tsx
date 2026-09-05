"use client";

import { HugeiconsIcon } from "@hugeicons/react";

import { Key01Icon } from "@hugeicons/core-free-icons";

import { useState, type FormEvent } from "react";
import type { SecretMetadata, Server } from "@workspace/towbar-web-client";
import { Button } from "@workspace/web-design-system/buttons/button";
import { Chip } from "@workspace/web-design-system/data-display/chip";
import { FieldError } from "@workspace/web-design-system/forms/field";
import { Label } from "@workspace/web-design-system/forms/label";
import { Switch } from "@workspace/web-design-system/forms/switch";
import { Textarea } from "@workspace/web-design-system/forms/textarea";
import { toast } from "@workspace/web-design-system/overlays/toast";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";

import { FormCard } from "@/components/page-parts";
import { refreshApiQueries, useApiQuery } from "@/hooks/use-api-query";
import { api } from "@/lib/api";

type CredentialKey = "apiToken" | "privateKey";

export function ServerCredentials({
  canManage,
  server,
}: {
  canManage: boolean;
  server: Server;
}) {
  const endpoint = `/v1/core/servers/${server.id}/credentials`;
  const query = useApiQuery<{
    credential: SecretMetadata;
    canManage: boolean;
  }>(endpoint);
  if (query.error) return <QueryError message={query.error} />;
  if (!query.data) return <QueryLoading />;
  return (
    <ServerCredentialForm
      key={`${query.data.credential.revision ?? "empty"}:${Boolean(server.config.proxy?.cloudflare.enabled)}`}
      canManage={canManage && query.data.canManage}
      credential={query.data.credential}
      endpoint={endpoint}
      refresh={query.refresh}
      server={server}
    />
  );
}

function ServerCredentialForm({
  canManage,
  credential,
  endpoint,
  refresh,
  server,
}: {
  canManage: boolean;
  credential: SecretMetadata;
  endpoint: string;
  refresh: () => void;
  server: Server;
}) {
  const initialCloudflareEnabled = Boolean(
    server.config.proxy?.cloudflare.enabled,
  );
  const [cloudflareEnabled, setCloudflareEnabled] = useState(
    initialCloudflareEnabled,
  );
  const [set, setValues] = useState<Partial<Record<CredentialKey, string>>>({});
  const [deleted, setDeleted] = useState<CredentialKey[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const cloudflareChanged = cloudflareEnabled !== initialCloudflareEnabled;
  const credentialsChanged = Object.keys(set).length > 0 || deleted.length > 0;

  async function saveServerConfiguration(enabled: boolean) {
    await api.patch(`/v1/core/servers/${server.id}`, {
      buildConcurrency: server.config.buildConcurrency,
      previewBuildConcurrency: server.config.previewBuildConcurrency,
      ip: server.canonicalIp,
      ssh: {
        host: server.config.ssh.host,
        port: server.config.ssh.port,
        username: server.config.ssh.username,
      },
      ...(enabled ? { proxy: { cloudflare: { enabled: true } } } : {}),
    });
  }

  async function saveCredentials() {
    await api.patch(endpoint, {
      expectedRevision: credential.revision,
      set,
      delete: deleted,
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    if (!credentialsChanged && !cloudflareChanged) {
      setError(
        "Enter a replacement, remove a value, or change Cloudflare DNS TLS.",
      );
      return;
    }

    const tokenConfigured = credential.keys.includes("apiToken");
    const tokenWillBeConfigured = deleted.includes("apiToken")
      ? false
      : Object.hasOwn(set, "apiToken")
        ? Boolean(set.apiToken?.trim())
        : tokenConfigured;
    if (cloudflareEnabled && !tokenWillBeConfigured) {
      setError(
        "Enter a Cloudflare API token before enabling Cloudflare DNS TLS.",
      );
      return;
    }

    setBusy(true);
    let credentialsSaved = false;
    let configurationSaved = false;
    try {
      if (cloudflareEnabled && credentialsChanged) {
        await saveCredentials();
        credentialsSaved = true;
      }
      if (cloudflareChanged) {
        await saveServerConfiguration(cloudflareEnabled);
        configurationSaved = true;
      }
      if (!cloudflareEnabled && credentialsChanged) {
        await saveCredentials();
        credentialsSaved = true;
      }
      setValues({});
      setDeleted([]);
      refresh();
      refreshApiQueries();
      toast.success("Server credentials saved");
    } catch (failure) {
      if (credentialsSaved || configurationSaved) {
        refresh();
        refreshApiQueries();
      }
      setError(
        credentialsSaved || configurationSaved
          ? "Some changes were saved. Refresh the page before trying again."
          : failure instanceof Error
            ? failure.message
            : "Server credentials could not be saved",
      );
    } finally {
      setBusy(false);
    }
  }

  function changeCloudflareEnabled(selected: boolean) {
    setCloudflareEnabled(selected);
    if (!selected) {
      setValues((current) => {
        const next = { ...current };
        delete next.apiToken;
        return next;
      });
      setDeleted((current) => current.filter((key) => key !== "apiToken"));
    }
  }

  return (
    <FormCard
      icon={<HugeiconsIcon icon={Key01Icon} />}
      title="Server credentials"
    >
      <form className="grid max-w-3xl gap-5" onSubmit={submit}>
        <CredentialField
          busy={busy}
          canManage={canManage}
          configured={credential.keys.includes("privateKey")}
          deleted={deleted.includes("privateKey")}
          label="SSH private key"
          name="privateKey"
          value={set.privateKey ?? ""}
          onRemoveChange={(removed) =>
            setDeleted((current) =>
              removed
                ? [...current, "privateKey"]
                : current.filter((key) => key !== "privateKey"),
            )
          }
          onValueChange={(value) =>
            setValues((current) => ({ ...current, privateKey: value }))
          }
        />

        <Switch
          isDisabled={!canManage || busy}
          isSelected={cloudflareEnabled}
          onChange={changeCloudflareEnabled}
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

        {cloudflareEnabled ? (
          <CredentialField
            busy={busy}
            canManage={canManage}
            configured={credential.keys.includes("apiToken")}
            deleted={deleted.includes("apiToken")}
            label="Cloudflare API token"
            name="apiToken"
            value={set.apiToken ?? ""}
            onRemoveChange={(removed) =>
              setDeleted((current) =>
                removed
                  ? [...current, "apiToken"]
                  : current.filter((key) => key !== "apiToken"),
              )
            }
            onValueChange={(value) =>
              setValues((current) => ({ ...current, apiToken: value }))
            }
          />
        ) : null}

        {error ? (
          <FieldError>
            {error}{" "}
            <Button variant="ghost" onPress={refresh}>
              Refresh settings
            </Button>
          </FieldError>
        ) : null}
        {canManage ? (
          <Button type="submit" className="w-fit" isDisabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        ) : null}
      </form>
    </FormCard>
  );
}

function CredentialField({
  busy,
  canManage,
  configured,
  deleted,
  label,
  name,
  onRemoveChange,
  onValueChange,
  value,
}: {
  busy: boolean;
  canManage: boolean;
  configured: boolean;
  deleted: boolean;
  label: string;
  name: CredentialKey;
  onRemoveChange: (removed: boolean) => void;
  onValueChange: (value: string) => void;
  value: string;
}) {
  const id = `server-credentials-${name}`;
  return (
    <div className="grid gap-2">
      <div className="flex min-h-7 items-center gap-3">
        <label htmlFor={id} className="font-medium">
          {label}
        </label>
        <Chip
          size="small"
          variant={deleted ? "warning" : configured ? "success" : "secondary"}
        >
          {deleted
            ? "Will be removed"
            : configured
              ? "Configured"
              : "Not configured"}
        </Chip>
      </div>
      <Textarea
        id={id}
        autoComplete="off"
        disabled={!canManage || busy || deleted}
        placeholder={configured ? "Enter a replacement" : "Enter a value"}
        value={value}
        variant="secondary"
        onChange={(event) => onValueChange(event.currentTarget.value)}
      />
      {canManage && configured ? (
        <Button
          className="w-fit"
          variant="secondary"
          isDisabled={busy}
          onPress={() => onRemoveChange(!deleted)}
        >
          {deleted ? "Keep" : "Remove"}
        </Button>
      ) : null}
    </div>
  );
}
