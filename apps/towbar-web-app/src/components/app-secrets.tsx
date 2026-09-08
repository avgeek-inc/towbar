"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Delete02Icon,
  ViewIcon,
  ViewOffSlashIcon,
  Key01Icon,
  LockIcon,
  RestoreBinIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type {
  AppSecretBinding,
  AppSecretStage,
  AppSecretsResponse,
} from "@workspace/towbar-web-client";
import { Button } from "@workspace/web-design-system/buttons/button";
import { EmptyState } from "@workspace/web-design-system/data-display/empty-state";
import { Input } from "@workspace/web-design-system/forms/input";
import { InputGroup } from "@workspace/web-design-system/forms/input-group";
import { FieldError } from "@workspace/web-design-system/forms/field";
import { Widget } from "@workspace/web-design-system/data-display/widget";
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

export function AppSecrets({ appId }: { appId: string }) {
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
    <div className="max-w-5xl">
      <ResponsiveSubtabs
        ariaLabel="Secret environments"
        defaultSelectedKey="production"
        layout="inline"
        selectedKey={environment}
        onSelectionChange={(key) =>
          setEnvironment(String(key) as "production" | "preview")
        }
        tabs={(["production", "preview"] as const).map((value) => ({
          label: value === "production" ? "Production" : "Preview",
          value,
          content:
            value === environment ? (
              <EnvironmentEditors
                key={environment}
                endpoint={endpoint}
                query={query}
              />
            ) : null,
        }))}
      />
    </div>
  );
}

export function ResourceSecrets({ resourceId }: { resourceId: string }) {
  const active = useSearchParams().get("section") === "settings";
  const endpoint = `/v1/core/resources/${resourceId}/secrets`;
  const query = useApiQuery<AppSecretsResponse>(active ? endpoint : null);
  if (!active) return null;
  return (
    <div className="max-w-5xl">
      <EnvironmentEditors endpoint={endpoint} query={query} />
    </div>
  );
}

type Query = { data?: AppSecretsResponse; error?: string; refresh: () => void };

export function GlobalSecrets() {
  return (
    <EnvironmentSecretSettings
      active
      endpoint="/v1/core/settings/secrets"
      scope="global"
    />
  );
}

export function SourceSecrets({
  active,
  sourceId,
}: {
  active: boolean;
  sourceId: string;
}) {
  return (
    <EnvironmentSecretSettings
      active={active}
      endpoint={`/v1/core/sources/${sourceId}/secrets`}
      scope="source"
    />
  );
}

function EnvironmentSecretSettings({
  active,
  endpoint,
  scope,
}: {
  active: boolean;
  endpoint: string;
  scope: "global" | "source";
}) {
  const [environment, setEnvironment] = useState<"production" | "preview">(
    "production",
  );
  const query = useApiQuery<AppSecretsResponse>(
    active ? `${endpoint}?environment=${environment}` : null,
  );
  if (!active) return null;
  return (
    <div className={scope === "global" ? "w-full" : "max-w-5xl"}>
      <ResponsiveSubtabs
        ariaLabel="Secret environments"
        defaultSelectedKey="production"
        layout="inline"
        selectedKey={environment}
        onSelectionChange={(key) =>
          setEnvironment(String(key) as "production" | "preview")
        }
        tabs={(["production", "preview"] as const).map((value) => ({
          label: value === "production" ? "Production" : "Preview",
          value,
          content:
            value === environment ? (
              <EnvironmentEditors
                key={environment}
                endpoint={endpoint}
                query={query}
              />
            ) : null,
        }))}
      />
    </div>
  );
}

function EnvironmentEditors({
  query,
  ...props
}: {
  query: Query;
  endpoint: string;
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
            key={`${props.endpoint}:${binding.environment}:${binding.stage}:${binding.revision}:${binding.inheritedRevisions.global}:${binding.inheritedRevisions.source}`}
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
  onUpdated,
}: {
  binding: AppSecretBinding;
  endpoint: string;
  canManage: boolean;
  onUpdated: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [replacements, setReplacements] = useState<Record<string, string>>({});
  const [deleted, setDeleted] = useState<string[]>([]);
  const [newKeys, setNewKeys] = useState<
    Array<{ id: string; key: string; value: string }>
  >([]);
  const [error, setError] = useState<string>();
  const keys = [...binding.keys].sort();
  const hasChanges =
    Object.keys(replacements).length > 0 ||
    deleted.length > 0 ||
    newKeys.length > 0;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
  const stageLabel = stageLabels[binding.stage];
  return (
    <form onSubmit={submit}>
      <Widget className="min-w-0">
        <Widget.Header>
          <Widget.Title icon={<HugeiconsIcon icon={Key01Icon} />}>
            {stageLabel} secrets
          </Widget.Title>
        </Widget.Header>
        <Widget.Content className="content-grid min-w-0">
          <p className="text-sm text-muted">
            {endpoint === "/v1/core/settings/secrets" ? (
              <>
                Store reusable values here. Children use{" "}
                <code>{"{{globals.ENV_KEY}}"}</code> to reference them.
              </>
            ) : (
              <>
                Shared secrets are not added automatically. Use{" "}
                <code>{"{{globals.ENV_KEY}}"}</code> for a global value
                {endpoint.includes("/apps/") ||
                endpoint.includes("/resources/") ? (
                  <>
                    {" "}
                    or <code>{"{{source.ENV_KEY}}"}</code> for a source value
                  </>
                ) : null}
                . References use this environment and stage.
              </>
            )}
          </p>
          {binding.availableReferences &&
          (binding.availableReferences.globals.length > 0 ||
            binding.availableReferences.source.length > 0) ? (
            <details className="text-sm text-muted">
              <summary className="cursor-pointer">Available references</summary>
              <div className="mt-2 flex flex-wrap gap-2">
                {Object.entries(binding.availableReferences).flatMap(
                  ([scope, names]) =>
                    names.map((name) => (
                      <code
                        key={`${scope}.${name}`}
                      >{`{{${scope}.${name}}}`}</code>
                    )),
                )}
              </div>
            </details>
          ) : null}
          {!keys.length && !newKeys.length ? (
            <EmptyState>
              <EmptyState.Header>
                <EmptyState.Title>
                  No {stageLabel.toLowerCase()} secrets
                </EmptyState.Title>
                <EmptyState.Description className="max-w-sm text-pretty">
                  Add a variable to make it available at this stage.
                </EmptyState.Description>
              </EmptyState.Header>
              {canManage ? (
                <EmptyState.Content>
                  <Button
                    onPress={() =>
                      setNewKeys([
                        { id: crypto.randomUUID(), key: "", value: "" },
                      ])
                    }
                  >
                    Add variable
                  </Button>
                </EmptyState.Content>
              ) : null}
            </EmptyState>
          ) : null}
          {keys.length > 0 || newKeys.length > 0 ? (
            <div className="grid gap-3">
              {keys.map((key) => {
                const removed = deleted.includes(key);
                return (
                  <div
                    key={key}
                    className="grid grid-cols-[repeat(8,minmax(0,1fr))_2.5rem] sm:grid-cols-[repeat(8,minmax(0,1fr))_2.25rem] items-center gap-2 md:gap-3"
                  >
                    <div className="col-span-4 flex min-h-10 min-w-0 items-center gap-2">
                      <span
                        className={`break-all font-mono text-sm ${
                          removed ? "text-muted line-through" : ""
                        }`}
                      >
                        {key}
                      </span>
                    </div>
                    <div className="col-span-4 min-w-0">
                      <SecretValueInput
                        label={`Value for ${key}`}
                        value={replacements[key] ?? ""}
                        configured={!Object.hasOwn(replacements, key)}
                        disabled={!canManage || busy || removed}
                        reveal={async () => {
                          const result = await api.post<{
                            value: string;
                            revision: string | null;
                          }>(
                            `${endpoint}/${binding.environment}/${binding.stage}/reveal`,
                            { key },
                          );
                          if (result.revision !== binding.revision)
                            throw new Error(
                              "This secret changed. Refresh before viewing it.",
                            );
                          return result.value;
                        }}
                        onChange={(value) =>
                          setReplacements((current) => ({
                            ...current,
                            [key]: value,
                          }))
                        }
                      />
                    </div>
                    {canManage ? (
                      <Button
                        aria-label={removed ? `Keep ${key}` : `Remove ${key}`}
                        className="col-span-1 size-10 min-w-0 justify-self-end sm:size-9"
                        isIconOnly
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
                        <HugeiconsIcon
                          aria-hidden="true"
                          icon={removed ? RestoreBinIcon : Delete02Icon}
                          size={18}
                        />
                      </Button>
                    ) : null}
                  </div>
                );
              })}
              {newKeys.map((row, index) => (
                <div
                  key={row.id}
                  className="grid grid-cols-[repeat(8,minmax(0,1fr))_2.5rem] sm:grid-cols-[repeat(8,minmax(0,1fr))_2.25rem] items-center gap-2 md:gap-3"
                >
                  <div className="col-span-4 min-w-0">
                    <Input
                      aria-label={`New variable ${index + 1} name`}
                      autoComplete="off"
                      placeholder="VARIABLE_NAME"
                      spellCheck={false}
                      variant="secondary"
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
                  </div>
                  <div className="col-span-4 min-w-0">
                    <SecretValueInput
                      label={`New variable ${index + 1} value`}
                      value={row.value}
                      disabled={busy}
                      onChange={(value) =>
                        setNewKeys((current) =>
                          current.map((item) =>
                            item.id === row.id ? { ...item, value } : item,
                          ),
                        )
                      }
                    />
                  </div>
                  <Button
                    aria-label={`Remove new variable ${index + 1}`}
                    className="col-span-1 size-10 min-w-0 justify-self-end sm:size-9"
                    isIconOnly
                    variant="secondary"
                    isDisabled={busy}
                    onPress={() =>
                      setNewKeys((current) =>
                        current.filter((item) => item.id !== row.id),
                      )
                    }
                  >
                    <HugeiconsIcon
                      aria-hidden="true"
                      icon={Delete02Icon}
                      size={18}
                    />
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
          {error ? (
            <FieldError>
              {error}{" "}
              <Button variant="ghost" onPress={onUpdated}>
                Refresh secrets
              </Button>
            </FieldError>
          ) : null}
          {canManage && (keys.length > 0 || newKeys.length > 0) ? (
            <div className="flex flex-wrap gap-2">
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
              <Button type="submit" isDisabled={busy || !hasChanges}>
                {busy ? "Saving…" : "Save"}
              </Button>
            </div>
          ) : null}
        </Widget.Content>
      </Widget>
    </form>
  );
}

function SecretValueInput({
  label,
  value,
  configured = false,
  disabled,
  reveal,
  onChange,
}: {
  label: string;
  value: string;
  configured?: boolean;
  disabled: boolean;
  reveal?: () => Promise<string>;
  onChange: (value: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  const [stored, setStored] = useState<string>();
  const [loading, setLoading] = useState(false);
  const request = useRef({ generation: 0 });
  useEffect(() => {
    const state = request.current;
    const hide = () => {
      state.generation++;
      setVisible(false);
      setStored(undefined);
      setLoading(false);
    };
    window.addEventListener("blur", hide);
    return () => {
      state.generation++;
      window.removeEventListener("blur", hide);
    };
  }, []);
  async function toggle() {
    const current = ++request.current.generation;
    if (visible) {
      setVisible(false);
      setStored(undefined);
      return;
    }
    if (!configured) {
      setVisible(true);
      return;
    }
    setLoading(true);
    try {
      const revealed = await reveal!();
      if (request.current.generation !== current) return;
      setStored(revealed);
      setVisible(true);
    } catch (error) {
      if (request.current.generation === current)
        toast.danger(
          error instanceof Error
            ? error.message
            : "Secret could not be revealed",
        );
    } finally {
      if (request.current.generation === current) setLoading(false);
    }
  }
  return (
    <InputGroup fullWidth variant="secondary">
      <InputGroup.Prefix>
        <HugeiconsIcon aria-hidden="true" icon={LockIcon} size={16} />
      </InputGroup.Prefix>
      <InputGroup.Input
        aria-label={label}
        type={visible ? "text" : "password"}
        autoComplete="off"
        data-lpignore="true"
        data-1p-ignore
        spellCheck={false}
        placeholder={
          configured ? "Configured — enter a replacement" : "Value or reference"
        }
        value={configured ? (visible ? (stored ?? "") : "") : value}
        disabled={disabled || loading}
        onChange={(event) => {
          setStored(undefined);
          onChange(event.currentTarget.value);
        }}
      />
      <InputGroup.Suffix>
        <Button
          type="button"
          isIconOnly
          variant="ghost"
          size="sm"
          aria-label={`${visible ? "Hide" : "Reveal"} ${label.toLowerCase()}`}
          aria-pressed={visible}
          isDisabled={disabled || loading}
          onPress={() => void toggle()}
        >
          <HugeiconsIcon
            aria-hidden="true"
            icon={visible ? ViewOffSlashIcon : ViewIcon}
            size={18}
          />
        </Button>
      </InputGroup.Suffix>
    </InputGroup>
  );
}
