"use client";
import { useDetailNavigation } from "@/hooks/use-detail-navigation";
import { usePageQuery, useQueryChoice } from "@/hooks/use-page-query";
import { PageSelectionTitle } from "./page-selection-title";
import { SecondaryItems } from "./secondary-sidebar";
import {
  Add01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Delete02Icon,
  FloppyDiskIcon,
  Key01Icon,
  LockIcon,
  Menu01Icon,
  PackageIcon,
  PlayIcon,
  ReloadIcon,
  Rocket01Icon,
  ServerStack01Icon,
  RestoreBinIcon,
  SourceCodeIcon,
  ViewIcon,
  ViewOffSlashIcon,
} from "@hugeicons/core-free-icons";

import dynamic from "next/dynamic";
import { ResponsiveChoice } from "./responsive-choice";
import { Tabs } from "@workspace/web-design-system/navigation/tabs";
import { parseSecretEnv, serializeSecretEnv } from "@/lib/secret-env";
import { useEffect, useRef, useState, type FormEvent } from "react";

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

const CodeEditor = dynamic(() => import("./code-editor"), {
  ssr: false,
});

export const stageLabels: Record<AppSecretStage, string> = {
  build: "Build",
  deployment: "Runtime",
  pre_deploy: "Pre-deploy",
  post_deploy: "Post-deploy",
};

export function AppSecrets({ appId }: { appId: string }) {
  const active = useDetailNavigation().section === "settings";
  return (
    <EnvironmentSecretSettings
      active={active}
      endpoint={`/v1/core/apps/${appId}/secrets`}
      scope="app"
    />
  );
}

export function ResourceSecrets({ resourceId }: { resourceId: string }) {
  const active = useDetailNavigation().section === "settings";
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
  scope: "global" | "source" | "app";
}) {
  const { search, update } = usePageQuery();
  const defaults = useApiQuery<AppSecretsResponse>(active ? endpoint : null);
  const environments = defaults.data?.environments ?? [];
  const requested = search.get("environment");
  const environment =
    environments.find((name) => name === requested) ?? environments[0];
  const selectedQuery = useApiQuery<AppSecretsResponse>(
    active && environment && environment !== environments[0]
      ? `${endpoint}?environment=${encodeURIComponent(environment)}`
      : null,
  );
  const query = environment === environments[0] ? defaults : selectedQuery;
  if (!active) return null;
  return (
    <div className={scope === "global" ? "w-full" : "max-w-5xl"}>
      {scope === "global" ? (
        <PageSelectionTitle
          icon={
            <HugeiconsIcon
              icon={
                environment === "preview" || environment?.startsWith("preview:")
                  ? Rocket01Icon
                  : ServerStack01Icon
              }
            />
          }
          label={`${secretEnvironmentLabel(environment ?? "")} shared secrets`}
        />
      ) : null}
      {scope === "global" ? (
        <SecondaryItems
          title="Environment"
          selected={environment ?? ""}
          onSelect={(value) =>
            update({ environment: value === environments[0] ? null : value })
          }
          items={environments.map((name) => ({
            id: name,
            label: secretEnvironmentLabel(name),
            icon: (
              <HugeiconsIcon
                icon={
                  name === "preview" || name.startsWith("preview:")
                    ? Rocket01Icon
                    : ServerStack01Icon
                }
              />
            ),
          }))}
        />
      ) : null}
      <EnvironmentEditors
        key={environment}
        endpoint={endpoint}
        query={query}
        environment={scope !== "global" ? environment : undefined}
        environments={environments}
        onEnvironmentChange={(value) =>
          update({ environment: value === environments[0] ? null : value })
        }
      />
    </div>
  );
}

function secretEnvironmentLabel(name: string) {
  const preview = name.startsWith("preview:");
  const label = preview ? name.slice(8) : name;
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}${preview ? " previews" : ""}`;
}

const stageIcons = {
  build: PackageIcon,
  deployment: PlayIcon,
  pre_deploy: ArrowLeft01Icon,
  post_deploy: ArrowRight01Icon,
};

function EnvironmentEditors({
  query,
  endpoint,
  environment,
  onEnvironmentChange,
  environments = [],
}: {
  query: Query;
  endpoint: string;
  environment?: string;
  environments?: string[];
  onEnvironmentChange?: (value: string) => void;
}) {
  const [stage, setStage] = useQueryChoice(
    "stage",
    ["build", "deployment", "pre_deploy", "post_deploy"],
    "build",
  );
  const data = query.data;
  const binding =
    data?.bindings.find((item) => item.stage === stage) ?? data?.bindings[0];
  return (
    <div className="grid min-w-0 gap-4">
      <div
        className={
          environment
            ? "grid min-w-0 gap-3 grid-cols-2 md:grid-cols-1"
            : "grid min-w-0 gap-3"
        }
      >
        {environment && onEnvironmentChange ? (
          <ResponsiveChoice
            label="Secret environment"
            value={environment}
            onChange={onEnvironmentChange}
            options={environments.map((name) => ({
              value: name,
              label: secretEnvironmentLabel(name),
              icon:
                name === "preview" || name.startsWith("preview:")
                  ? Rocket01Icon
                  : ServerStack01Icon,
            }))}
          />
        ) : null}
        {binding && data ? (
          <ResponsiveChoice
            label="Secret stage"
            value={binding.stage}
            options={data.bindings.map((item) => ({
              value: item.stage,
              label: stageLabels[item.stage],
              icon: stageIcons[item.stage],
            }))}
            onChange={(value) => setStage(value as AppSecretStage)}
          />
        ) : null}
      </div>
      {query.error ? (
        <QueryError message={query.error} />
      ) : !data ? (
        <QueryLoading />
      ) : binding ? (
        <SecretVariablesEditor
          key={`${endpoint}:${binding.environment}:${binding.stage}:${binding.revision}:${binding.inheritedRevisions.global}:${binding.inheritedRevisions.source}`}
          endpoint={endpoint}
          binding={binding}
          canManage={data.canManageSecrets}
          onUpdated={query.refresh}
        />
      ) : null}
    </div>
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
  const [fileMode, setFileMode] = useState(false);
  const [fileText, setFileText] = useState("");
  const [initialFile, setInitialFile] = useState("");
  const originalValues = useRef(new Map<string, string>());
  const modeRequest = useRef(0);
  useEffect(
    () => () => {
      modeRequest.current++;
    },
    [],
  );
  const keys = [...binding.keys].sort();
  const hasChanges =
    (fileMode &&
      (fileText !== initialFile || Boolean(binding.missingKeys?.length))) ||
    Object.keys(replacements).length > 0 ||
    deleted.length > 0 ||
    newKeys.length > 0;
  function fileChanges() {
    const values = parseSecretEnv(fileText);
    if (
      binding.declared &&
      (keys.some((key) => !values.has(key)) ||
        [...values.keys()].some((key) => !keys.includes(key)))
    )
      throw new Error(
        "Secret keys are managed in YAML. Keep the declared keys and edit only their values.",
      );
    const replacement: Record<string, string> = Object.create(null);
    const added: Array<{ id: string; key: string; value: string }> = [];
    for (const [key, value] of values) {
      if (keys.includes(key)) {
        if (value !== originalValues.current.get(key)) replacement[key] = value;
      } else added.push({ id: crypto.randomUUID(), key, value });
    }
    return {
      replacement,
      added,
      removed: keys.filter((key) => !values.has(key)),
    };
  }
  async function toggleMode() {
    if (busy) return;
    const request = ++modeRequest.current;
    setBusy(true);
    try {
      if (fileMode) {
        const changes = fileChanges();
        setReplacements(changes.replacement);
        setNewKeys(changes.added);
        setDeleted(changes.removed);
        setFileText("");
        originalValues.current.clear();
      } else {
        const entries: Array<[string, string]> = [];
        const stored = new Map<string, string>();
        const retained = keys.filter((key) => !deleted.includes(key));
        if (retained.length > 0) {
          const result = await api.post<{
            values: Record<string, string>;
            revision: string | null;
          }>(
            `${endpoint}/${binding.environment}/${binding.stage}/reveal-all`,
            {},
          );
          if (request !== modeRequest.current) return;
          if (result.revision !== binding.revision)
            throw new Error(
              "Secrets changed. Refresh before opening file mode.",
            );
          for (const key of retained) {
            if (
              !Object.hasOwn(result.values, key) &&
              !binding.missingKeys?.includes(key)
            )
              throw new Error(
                "Secrets changed. Refresh before opening file mode.",
              );
            if (Object.hasOwn(result.values, key))
              stored.set(key, result.values[key]!);
            entries.push([
              key,
              Object.hasOwn(replacements, key)
                ? replacements[key]!
                : (result.values[key] ?? ""),
            ]);
          }
        }
        for (const row of newKeys) {
          if (!row.key.trim() && !row.value) continue;
          entries.push([row.key.trim(), row.value]);
        }
        const text = serializeSecretEnv(entries);
        parseSecretEnv(text);
        originalValues.current = stored;
        setFileText(text);
        setInitialFile(text);
      }
      setError(undefined);
      setFileMode(!fileMode);
    } catch (failure) {
      if (request === modeRequest.current)
        setError(
          failure instanceof Error
            ? failure.message
            : "Could not open file mode.",
        );
    } finally {
      if (request === modeRequest.current) setBusy(false);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let draft;
    try {
      draft = fileMode
        ? fileChanges()
        : { replacement: replacements, added: newKeys, removed: deleted };
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Check the .env file.",
      );
      return;
    }
    const set: Record<string, string> = Object.assign(
      Object.create(null),
      draft.replacement,
    );
    const seen = new Set(keys);
    for (const row of draft.added) {
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
    if (!Object.keys(set).length && !draft.removed.length) {
      setError("Add, replace, or remove at least one variable.");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await api.patch(`${endpoint}/${binding.environment}/${binding.stage}`, {
        expectedRevision: binding.revision,
        set,
        delete: draft.removed,
      });
      setReplacements({});
      setDeleted([]);
      setNewKeys([]);
      setFileMode(false);
      setFileText("");
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
          {fileMode && binding.declared && binding.missingKeys?.length ? (
            <p className="text-xs text-muted">
              Required keys without saved values appear blank. Saving a blank
              value sets it to an intentionally empty string.
            </p>
          ) : null}
          <Tabs
            selectedKey={fileMode ? "file" : "form"}
            onSelectionChange={(key) => {
              if ((key === "file") !== fileMode) void toggleMode();
            }}
          >
            <Tabs.ListContainer className="mb-4 w-fit">
              <Tabs.List aria-label="Secret editing mode">
                <Tabs.Tab id="form" className="gap-2" isDisabled={busy}>
                  <HugeiconsIcon
                    aria-hidden="true"
                    icon={Menu01Icon}
                    size={16}
                  />
                  Form
                  <Tabs.Indicator />
                </Tabs.Tab>
                <Tabs.Tab
                  id="file"
                  className="gap-2"
                  isDisabled={busy || !canManage}
                >
                  <HugeiconsIcon
                    aria-hidden="true"
                    icon={SourceCodeIcon}
                    size={16}
                  />
                  {busy && !fileMode ? "Loading…" : "File"}
                  <Tabs.Indicator />
                </Tabs.Tab>
              </Tabs.List>
            </Tabs.ListContainer>
            <Tabs.Panel
              id={fileMode ? "file" : "form"}
              key={fileMode ? "file" : "form"}
              className="content-grid m-0 min-w-0 p-0"
            >
              {fileMode ? (
                <div className="grid min-w-0 gap-3">
                  <CodeEditor
                    value={fileText}
                    onChange={setFileText}
                    disabled={busy}
                  />
                </div>
              ) : null}
              {!fileMode && !keys.length && !newKeys.length ? (
                <EmptyState>
                  <EmptyState.Header>
                    <EmptyState.Title>
                      No {stageLabel.toLowerCase()} secrets
                    </EmptyState.Title>
                    <EmptyState.Description className="max-w-sm text-pretty">
                      {binding.declared
                        ? "Declare required keys in the entity YAML and sync this environment."
                        : "Add a variable to make it available at this stage."}
                    </EmptyState.Description>
                  </EmptyState.Header>
                  {canManage && !binding.declared ? (
                    <EmptyState.Content>
                      <Button
                        onPress={() =>
                          setNewKeys([
                            { id: crypto.randomUUID(), key: "", value: "" },
                          ])
                        }
                      >
                        <HugeiconsIcon
                          aria-hidden="true"
                          icon={Add01Icon}
                          className="size-4 shrink-0"
                        />
                        Add variable
                      </Button>
                    </EmptyState.Content>
                  ) : null}
                </EmptyState>
              ) : null}
              {!fileMode && (keys.length > 0 || newKeys.length > 0) ? (
                <div className="grid gap-3">
                  {keys.map((key) => {
                    const removed = deleted.includes(key);
                    return (
                      <div
                        key={key}
                        className={
                          binding.declared
                            ? "grid grid-cols-8 items-center gap-2 md:gap-3"
                            : "grid grid-cols-[repeat(8,minmax(0,1fr))_2.5rem] sm:grid-cols-[repeat(8,minmax(0,1fr))_2.25rem] items-center gap-2 md:gap-3"
                        }
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
                            configured={
                              !Object.hasOwn(replacements, key) &&
                              !binding.missingKeys?.includes(key)
                            }
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
                        {canManage && !binding.declared ? (
                          <Button
                            aria-label={
                              removed ? `Keep ${key}` : `Remove ${key}`
                            }
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
                          fullWidth
                          placeholder="VARIABLE_NAME"
                          spellCheck={false}
                          variant="secondary"
                          disabled={busy}
                          value={row.key}
                          onChange={(event) => {
                            const value = event.currentTarget.value;
                            setNewKeys((current) =>
                              current.map((item) =>
                                item.id === row.id
                                  ? { ...item, key: value }
                                  : item,
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
                    <HugeiconsIcon
                      aria-hidden="true"
                      icon={ReloadIcon}
                      className="size-4 shrink-0"
                    />
                    Refresh secrets
                  </Button>
                </FieldError>
              ) : null}
              {canManage &&
              (fileMode || keys.length > 0 || newKeys.length > 0) ? (
                <div className="flex flex-wrap gap-2">
                  {!fileMode && !binding.declared ? (
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
                      <HugeiconsIcon
                        aria-hidden="true"
                        icon={Add01Icon}
                        className="size-4 shrink-0"
                      />
                      Add variable
                    </Button>
                  ) : null}
                  <Button type="submit" isDisabled={busy || !hasChanges}>
                    <HugeiconsIcon
                      aria-hidden="true"
                      icon={FloppyDiskIcon}
                      className="size-4 shrink-0"
                    />
                    {busy ? "Saving…" : "Save"}
                  </Button>
                </div>
              ) : null}
            </Tabs.Panel>
          </Tabs>
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
  const displayedValue = configured ? (visible ? (stored ?? "") : "") : value;
  const hasReference =
    visible &&
    /\{\{\s*(globals|source)\.[A-Za-z_][A-Za-z0-9_]*\s*\}\}/u.test(
      displayedValue,
    );
  return (
    <InputGroup fullWidth variant="secondary">
      <InputGroup.Prefix>
        <HugeiconsIcon aria-hidden="true" icon={LockIcon} size={16} />
      </InputGroup.Prefix>
      <InputGroup.Input
        aria-label={label}
        className={
          hasReference ? "text-yellow-600 dark:text-yellow-400" : undefined
        }
        type={visible ? "text" : "password"}
        autoComplete="off"
        data-lpignore="true"
        data-1p-ignore
        spellCheck={false}
        placeholder={
          configured ? (visible ? "" : "∗∗∗∗∗∗∗∗") : "Value or reference"
        }
        value={displayedValue}
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
