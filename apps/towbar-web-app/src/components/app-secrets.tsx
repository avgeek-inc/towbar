"use client";

import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import type {
  AppSecretBinding,
  AppSecretStage,
  AppSecretsResponse,
} from "@workspace/towbar-web-client";
import { Button } from "@workspace/web-design-system/buttons/button";
import { Input } from "@workspace/web-design-system/forms/input";
import { Textarea } from "@workspace/web-design-system/forms/textarea";
import { FieldError } from "@workspace/web-design-system/forms/field";
import { toast } from "@workspace/web-design-system/overlays/toast";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { useApiQuery } from "@/hooks/use-api-query";
import { api } from "@/lib/api";
import { ResponsiveSubtabs } from "./responsive-subtabs";

export const stageLabels: Record<AppSecretStage, string> = {
  build: "Build",
  deployment: "Runtime",
  pre_deploy: "Pre-deploy",
  post_deploy: "Post-deploy",
};

export function AppSecrets({
  appId,
  canDeploy,
  sourceId,
}: {
  appId: string;
  canDeploy: boolean;
  sourceId: string;
}) {
  const active = useSearchParams().get("section") === "settings";
  const [environment, setEnvironment] = useState<"production" | "preview">(
    "production",
  );
  const endpoint = `/v1/core/apps/${appId}/secrets`;
  const query = useApiQuery<AppSecretsResponse>(
    active ? `${endpoint}?environment=${environment}` : null,
  );
  if (!active) return null;
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap gap-2" aria-label="Secret environment">
        {(["production", "preview"] as const).map((value) => (
          <Button
            key={value}
            variant={value === environment ? "primary" : "secondary"}
            aria-pressed={value === environment}
            onPress={() => setEnvironment(value)}
          >
            {value === "production" ? "Production" : "Preview"}
          </Button>
        ))}
      </div>
      <p className="text-muted">
        {environment === "preview"
          ? "Preview secrets are separate. Production and Source secrets are never inherited."
          : "Source defaults are inherited. App values override matching keys."}{" "}
        Saved values cannot be viewed.
      </p>
      <EnvironmentEditors
        key={environment}
        query={query}
        endpoint={endpoint}
        canDeploy={canDeploy && environment === "production"}
        deployable={{ id: appId, kind: "app" }}
        sourceId={sourceId}
      />
    </div>
  );
}

export function ResourceSecrets({
  resourceId,
  canDeploy,
  sourceId,
}: {
  resourceId: string;
  canDeploy: boolean;
  sourceId: string;
}) {
  const active = useSearchParams().get("section") === "settings";
  const endpoint = `/v1/core/resources/${resourceId}/secrets`;
  const query = useApiQuery<AppSecretsResponse>(active ? endpoint : null);
  if (!active) return null;
  return (
    <div className="grid gap-4">
      <p className="text-muted">
        Runtime values override Source defaults. Updating a stored password does
        not rotate the password inside an existing database.
      </p>
      <EnvironmentEditors
        query={query}
        endpoint={endpoint}
        canDeploy={canDeploy}
        deployable={{ id: resourceId, kind: "resource" }}
        sourceId={sourceId}
      />
    </div>
  );
}

type Query = { data?: AppSecretsResponse; error?: string; refresh: () => void };
export function SourceSecretStageEditor({
  query,
  sourceId,
  stage,
}: {
  query: Query;
  sourceId: string;
  stage: AppSecretStage;
}) {
  if (query.error) return <QueryError message={query.error} />;
  if (!query.data) return <QueryLoading />;
  const binding = query.data.bindings.find(
    (binding) => binding.stage === stage,
  );
  if (!binding) return null;
  return (
    <SecretVariablesEditor
      key={`${stage}:${binding.revision}`}
      binding={binding}
      endpoint={`/v1/core/sources/${sourceId}/secrets`}
      canManage={query.data.canManageSecrets}
      canDeploy={false}
      sourceId={sourceId}
      onUpdated={query.refresh}
    />
  );
}

function EnvironmentEditors({
  query,
  ...props
}: {
  query: Query;
  endpoint: string;
  canDeploy: boolean;
  deployable: { id: string; kind: "app" | "resource" };
  sourceId: string;
}) {
  if (query.error) return <QueryError message={query.error} />;
  if (!query.data) return <QueryLoading />;
  const data = query.data;
  return (
    <ResponsiveSubtabs
      ariaLabel="Secret stages"
      defaultSelectedKey={data.bindings[0]?.stage ?? "build"}
      layout="inline"
      tabs={data.bindings.map((binding) => ({
        label: stageLabels[binding.stage],
        value: binding.stage,
        content: (
          <SecretVariablesEditor
            key={`${binding.environment}:${binding.stage}:${binding.revision}:${binding.inheritedRevision}`}
            {...props}
            binding={binding}
            canManage={data.canManageSecrets}
            onUpdated={query.refresh}
          />
        ),
      }))}
    />
  );
}

function SecretVariablesEditor({
  binding,
  endpoint,
  canManage,
  canDeploy,
  deployable,
  onUpdated,
}: {
  binding: AppSecretBinding;
  endpoint: string;
  canManage: boolean;
  canDeploy: boolean;
  sourceId: string;
  deployable?: { id: string; kind: "app" | "resource" };
  onUpdated: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [replacements, setReplacements] = useState<Record<string, string>>({});
  const [deleted, setDeleted] = useState<string[]>([]);
  const [newKeys, setNewKeys] = useState<
    Array<{ id: string; key: string; value: string }>
  >([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const keys = [...new Set([...binding.inheritedKeys, ...binding.keys])].sort();
  const shared = !deployable;
  const selectTargets = shared || binding.environment === "preview";
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const intent = (
      (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null
    )?.value;
    const set: Record<string, string> = Object.assign(
      Object.create(null),
      replacements,
    );
    const seen = new Set(keys);
    for (const row of newKeys) {
      const key = row.key.trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key) || seen.has(key)) {
        setError(
          "Use unique variable names containing letters, numbers, and underscores, starting with a letter or underscore.",
        );
        return;
      }
      seen.add(key);
      set[key] = row.value;
    }
    if (!Object.keys(set).length && !deleted.length) {
      setError("Add, replace, or remove at least one variable.");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await api.patch(`${endpoint}/${binding.environment}/${binding.stage}`, {
        expectedRevision: binding.revision,
        set,
        delete: deleted,
      });
      setReplacements({});
      setDeleted([]);
      setNewKeys([]);
      toast.success("Secrets saved. Changes apply on the next deployment.");
      if (intent === "save-and-deploy") {
        const targets =
          !selectTargets && deployable
            ? [deployable]
            : binding.affectedDeployables.filter((item) =>
                selected.includes(item.id),
              );
        for (const target of targets) {
          try {
            await api.post(
              `/v1/core/${target.kind}s/${target.id}/actions/deploy`,
              undefined,
              { "Idempotency-Key": crypto.randomUUID() },
            );
            toast.success(
              `Deployment queued${"name" in target ? ` for ${target.name}` : ""}`,
            );
          } catch (failure) {
            toast.danger(
              `Secrets saved, but a deployment could not be queued: ${failure instanceof Error ? failure.message : "Request failed"}`,
            );
          }
        }
      }
      onUpdated();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Secrets could not be saved",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="grid gap-5" onSubmit={submit}>
      {binding.pendingChanges ? (
        <p role="status">Secret changes are waiting for deployment.</p>
      ) : null}
      {shared ? (
        <p className="text-muted">
          These {stageLabels[binding.stage].toLowerCase()} defaults apply to all
          applicable production apps and resources in this Source. Local
          overrides take precedence.
        </p>
      ) : null}
      {!keys.length && !newKeys.length ? (
        <p className="text-muted">
          No secrets configured. Add a variable to get started.
        </p>
      ) : null}
      {keys.map((key) => {
        const local = binding.keys.includes(key);
        const removed = deleted.includes(key);
        return (
          <div
            key={key}
            className="grid items-start gap-3 border-b border-border pb-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]"
          >
            <div className="min-w-0">
              <span className="break-all font-mono text-sm">{key}</span>
              <p className="text-muted text-sm">
                {removed
                  ? binding.inheritedKeys.includes(key)
                    ? "Source default will apply after saving"
                    : "Will be removed"
                  : local
                    ? binding.inheritedKeys.includes(key)
                      ? "Local override of Source default"
                      : "Configured locally"
                    : "Inherited from Source"}
              </p>
            </div>
            <Textarea
              aria-label={`Replacement value for ${key}`}
              autoComplete="off"
              placeholder={
                local
                  ? "Configured — enter a replacement"
                  : "Enter a local override"
              }
              value={Object.hasOwn(replacements, key) ? replacements[key]! : ""}
              disabled={!canManage || busy || removed}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setReplacements((current) => ({ ...current, [key]: value }));
              }}
            />
            {canManage && local ? (
              <Button
                variant="secondary"
                isDisabled={busy}
                onPress={() => {
                  setDeleted((current) =>
                    removed
                      ? current.filter((item) => item !== key)
                      : [...current, key],
                  );
                  setReplacements((current) => {
                    const next = { ...current };
                    delete next[key];
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
      {newKeys.map((row, index) => (
        <div
          key={row.id}
          className="grid items-start gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]"
        >
          <Input
            aria-label={`New variable ${index + 1} name`}
            placeholder="VARIABLE_NAME"
            disabled={busy}
            value={row.key}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setNewKeys((current) =>
                current.map((item) =>
                  item.id === row.id ? { ...item, key: value } : item,
                ),
              );
            }}
          />
          <Textarea
            aria-label={`New variable ${index + 1} value`}
            autoComplete="off"
            placeholder="Value"
            disabled={busy}
            value={row.value}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setNewKeys((current) =>
                current.map((item) =>
                  item.id === row.id ? { ...item, value } : item,
                ),
              );
            }}
          />
          <Button
            variant="secondary"
            isDisabled={busy}
            onPress={() =>
              setNewKeys((current) =>
                current.filter((item) => item.id !== row.id),
              )
            }
          >
            Remove
          </Button>
        </div>
      ))}
      {selectTargets && binding.affectedDeployables.length ? (
        <fieldset className="grid gap-2">
          <legend className="mb-2">
            {binding.environment === "preview"
              ? "Preview deployment targets"
              : "Affected apps and resources"}
          </legend>
          {binding.affectedDeployables.map((item) => (
            <label className="flex min-h-11 items-center gap-3" key={item.id}>
              <input
                type="checkbox"
                disabled={!canManage || busy}
                checked={selected.includes(item.id)}
                onChange={(event) => {
                  const checked = event.currentTarget.checked;
                  setSelected((current) =>
                    checked
                      ? [...current, item.id]
                      : current.filter((id) => id !== item.id),
                  );
                }}
              />
              {item.name}
            </label>
          ))}
          <p className="text-muted text-sm">
            Select targets to deploy after saving.{" "}
            {shared
              ? "Existing local overrides remain in effect."
              : "Each preview uses only app preview secrets."}
          </p>
        </fieldset>
      ) : null}
      {error ? (
        <FieldError>
          {error}{" "}
          <Button variant="ghost" onPress={onUpdated}>
            Refresh secrets
          </Button>
        </FieldError>
      ) : null}
      {canManage ? (
        <div className="flex flex-wrap justify-between gap-3">
          <Button
            variant="secondary"
            isDisabled={busy || newKeys.length >= 200}
            onPress={() =>
              setNewKeys((current) => [
                ...current,
                { id: crypto.randomUUID(), key: "", value: "" },
              ])
            }
          >
            Add variable
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              value="save"
              variant="secondary"
              isDisabled={busy}
            >
              {busy ? "Saving…" : "Save"}
            </Button>
            {canDeploy || (selectTargets && selected.length > 0) ? (
              <Button type="submit" value="save-and-deploy" isDisabled={busy}>
                Save and deploy
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </form>
  );
}
