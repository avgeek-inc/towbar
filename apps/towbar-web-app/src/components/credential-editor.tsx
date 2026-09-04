"use client";

import { useState, type FormEvent } from "react";
import type { SecretMetadata } from "@workspace/towbar-web-client";
import { Button } from "@workspace/web-design-system/buttons/button";
import { Textarea } from "@workspace/web-design-system/forms/textarea";
import { FieldError } from "@workspace/web-design-system/forms/field";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { toast } from "@workspace/web-design-system/overlays/toast";
import { useApiQuery } from "@/hooks/use-api-query";
import { api } from "@/lib/api";

export function CredentialEditor({
  endpoint,
  fields,
  title,
  description,
}: {
  endpoint: string;
  title: string;
  description: string;
  fields: Array<{ key: string; label: string; description?: string }>;
}) {
  const query = useApiQuery<{ credential: SecretMetadata; canManage: boolean }>(
    endpoint,
  );
  if (query.error) return <QueryError message={query.error} />;
  if (!query.data) return <QueryLoading />;
  return (
    <CredentialForm
      key={`${query.data.credential.revision ?? "empty"}:${fields
        .map((field) => field.key)
        .join(",")}`}
      {...{ endpoint, fields, title, description }}
      credential={query.data.credential}
      canManage={query.data.canManage}
      refresh={query.refresh}
    />
  );
}

function CredentialForm({
  endpoint,
  fields,
  title,
  description,
  credential,
  canManage,
  refresh,
}: {
  endpoint: string;
  title: string;
  description: string;
  fields: Array<{ key: string; label: string; description?: string }>;
  credential: SecretMetadata;
  canManage: boolean;
  refresh: () => void;
}) {
  const [set, setValues] = useState<Record<string, string>>({});
  const [deleted, setDeleted] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    if (!Object.keys(set).length && !deleted.length) {
      setError("Enter a replacement or remove a configured value.");
      return;
    }
    setBusy(true);
    try {
      await api.patch(endpoint, {
        expectedRevision: credential.revision,
        set,
        delete: deleted,
      });
      setValues({});
      setDeleted([]);
      refresh();
      toast.success(`${title} saved`);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Credentials could not be saved",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="grid max-w-3xl gap-5" onSubmit={submit}>
      <div>
        <h2 className="text-lg font-medium">{title}</h2>
        <p className="text-muted">
          {description} Saved values cannot be viewed.
        </p>
      </div>
      {fields.map((field) => {
        const configured = credential.keys.includes(field.key);
        const removed = deleted.includes(field.key);
        const id = `${title}-${field.key}`;
        return (
          <div key={field.key} className="grid gap-2">
            <label htmlFor={id} className="font-medium">
              {field.label}
            </label>
            <p className="text-muted text-sm">
              {removed
                ? "Will be removed"
                : configured
                  ? "Configured"
                  : "Not configured"}
              {field.description ? ` · ${field.description}` : ""}
            </p>
            <Textarea
              id={id}
              autoComplete="off"
              disabled={!canManage || busy || removed}
              value={set[field.key] ?? ""}
              placeholder={
                configured
                  ? "Enter a replacement to change this value"
                  : "Enter a value"
              }
              onChange={(event) => {
                const value = event.currentTarget.value;
                setValues((current) => ({ ...current, [field.key]: value }));
              }}
            />
            {canManage && configured ? (
              <Button
                className="w-fit"
                variant="secondary"
                isDisabled={busy}
                onPress={() => {
                  setDeleted((current) =>
                    removed
                      ? current.filter((key) => key !== field.key)
                      : [...current, field.key],
                  );
                  setValues((current) => {
                    const next = { ...current };
                    delete next[field.key];
                    return next;
                  });
                }}
              >
                {removed ? "Keep" : "Remove"}
              </Button>
            ) : null}
          </div>
        );
      })}
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
  );
}

export function ServerCredentials({
  cloudflareEnabled,
  serverId,
}: {
  cloudflareEnabled: boolean;
  serverId: string;
}) {
  return (
    <CredentialEditor
      endpoint={`/v1/core/servers/${serverId}/credentials`}
      title="Server credentials"
      description="Used by the next server operation or deployment. Saving does not change credentials on the server."
      fields={[
        {
          key: "privateKey",
          label: "SSH private key",
          description:
            "Paste an unencrypted private key, including its header and footer.",
        },
        ...(cloudflareEnabled
          ? [
              {
                key: "apiToken",
                label: "Cloudflare API token",
                description:
                  "Required while Cloudflare DNS TLS is enabled for this server.",
              },
            ]
          : []),
      ]}
    />
  );
}
