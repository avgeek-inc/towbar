"use client";
import { useAccess } from "./access-context";
import { useDetailNavigation } from "@/hooks/use-detail-navigation";
import { usePageQuery, useQueryChoice } from "@/hooks/use-page-query";
import { PageSelectionTitle } from "./page-selection-title";
import { SecondaryItems } from "./secondary-sidebar";
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Add01Icon,
  Delete02Icon,
  FloppyDiskIcon,
  LockIcon,
  Menu01Icon,
  PackageIcon,
  PlayIcon,
  Rocket01Icon,
  CloudIcon,
  SourceCodeIcon,
  ViewIcon,
  ViewOffSlashIcon,
} from "@hugeicons/core-free-icons";

import dynamic from "next/dynamic";
import { ResponsiveChoice } from "./responsive-choice";
import { Tabs } from "@workspace/web-design-system/navigation/tabs";
import {
  managedSecretKeyError,
  parseSecretEnv,
  serializeSecretEnv,
} from "@/lib/secret-env";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { HugeiconsIcon } from "@hugeicons/react";
import type {
  AppSecretBinding,
  AppSecretStage,
  AppSecretsResponse,
} from "@workspace/towbar-web-client";
import { Button } from "@workspace/web-design-system/buttons/button";
import { Chip } from "@workspace/web-design-system/data-display/chip";
import { EmptyState } from "@workspace/web-design-system/data-display/empty-state";
import { InputGroup } from "@workspace/web-design-system/forms/input-group";
import { Input } from "@workspace/web-design-system/forms/input";
import {
  FieldDescription,
  FieldError,
} from "@workspace/web-design-system/forms/field";
import { Widget } from "@workspace/web-design-system/data-display/widget";
import { toast } from "@workspace/web-design-system/overlays/toast";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { useApiQuery } from "@/hooks/use-api-query";
import { api } from "@/lib/api";

const CodeEditor = dynamic(() => import("./code-editor"), {
  ssr: false,
});

function isPreviewEnvironment(name: string | undefined) {
  return name === "preview" || name?.startsWith("preview:") === true;
}

function secretEnvironmentIcon(name: string | undefined) {
  return isPreviewEnvironment(name) ? Rocket01Icon : CloudIcon;
}

function secretEnvironmentIconClassName(name: string | undefined) {
  return name === "production" ? "text-danger" : "text-foreground";
}

const stageLabels: Record<AppSecretStage, string> = {
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
    />
  );
}

export function ResourceSecrets({ resourceId }: { resourceId: string }) {
  const active = useDetailNavigation().section === "settings";
  const endpoint = `/v1/core/resources/${resourceId}/secrets`;
  const query = useApiQuery<AppSecretsResponse>(active ? endpoint : null);
  if (!active) return null;
  return (
    <div className="w-full">
      <EnvironmentEditors endpoint={endpoint} query={query} />
    </div>
  );
}

type Query = { data?: AppSecretsResponse; error?: string; refresh: () => void };

export function GlobalSecrets() {
  const endpoint = "/v1/core/settings/secrets";
  const query = useApiQuery<AppSecretsResponse>(endpoint);
  const [stage, setStage] = useQueryChoice(
    "stage",
    ["build", "deployment", "pre_deploy", "post_deploy"],
    "build",
  );
  const binding = query.data?.bindings.find((item) => item.stage === stage);
  return (
    <div className="w-full">
      <PageSelectionTitle
        icon={<HugeiconsIcon icon={stageIcons[stage]} />}
        label={`${stageLabels[stage]} shared secrets`}
      />
      <SecondaryItems
        title="Secret stage"
        selected={stage}
        onSelect={(value) => setStage(value as AppSecretStage)}
        items={Object.entries(stageLabels).map(([id, label]) => ({
          id,
          label,
          icon: <HugeiconsIcon icon={stageIcons[id as AppSecretStage]} />,
        }))}
      />
      {query.error ? (
        <QueryError message={query.error} />
      ) : !query.data ? (
        <QueryLoading />
      ) : binding ? (
        <SecretVariablesEditor
          key={`${endpoint}:${binding.stage}:${binding.revision}`}
          endpoint={endpoint}
          binding={binding}
          canManage={query.data.canManageSecrets}
          canManageKeys
          onUpdated={query.refresh}
        />
      ) : null}
    </div>
  );
}

function EnvironmentSecretSettings({
  active,
  endpoint,
}: {
  active: boolean;
  endpoint: string;
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
    <div className="w-full">
      <EnvironmentEditors
        key={environment}
        endpoint={endpoint}
        query={query}
        environment={environment}
        environments={environments}
        onEnvironmentChange={(value) =>
          update({ environment: value === environments[0] ? null : value })
        }
      />
    </div>
  );
}

function secretEnvironmentLabel(name: string) {
  return isPreviewEnvironment(name) ? name.replace(/^preview:/, "") : name;
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
  if (data && !data.environments.length)
    return (
      <EmptyState>
        <EmptyState.Header>
          <EmptyState.Title>No connected environments</EmptyState.Title>
          <EmptyState.Description>
            Connect a repository environment to configure its shared secrets.
          </EmptyState.Description>
        </EmptyState.Header>
      </EmptyState>
    );
  return (
    <div className="grid min-w-0 gap-4">
      <div className="flex min-w-0 flex-wrap items-end gap-4">
        {environment && onEnvironmentChange ? (
          <div className="grid w-full min-w-0 gap-2 md:w-auto">
            <p className="text-xs text-muted">Environment</p>
            <ResponsiveChoice
              label="Environment"
              value={environment}
              onChange={onEnvironmentChange}
              options={environments.map((name) => ({
                value: name,
                label: secretEnvironmentLabel(name),
                icon: secretEnvironmentIcon(name),
                iconClassName: secretEnvironmentIconClassName(name),
              }))}
            />
          </div>
        ) : null}
        {binding && data ? (
          <div className="grid w-full min-w-0 gap-2 md:w-auto">
            <p className="text-xs text-muted">Secret stage</p>
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
          </div>
        ) : null}
      </div>
      {query.error ? (
        <QueryError message={query.error} />
      ) : !data ? (
        <QueryLoading />
      ) : binding ? (
        <SecretVariablesEditor
          key={`${endpoint}:${binding.environment}:${binding.stage}:${binding.revision}:${binding.inheritedRevisions.global}`}
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
  canManageKeys = false,
  onUpdated,
}: {
  binding: AppSecretBinding;
  endpoint: string;
  canManage: boolean;
  canManageKeys?: boolean;
  onUpdated: () => void;
}) {
  const { can } = useAccess();
  const canReveal = can(
    endpoint.includes("/secrets") &&
      !endpoint.includes("/apps/") &&
      !endpoint.includes("/resources/")
      ? "sharedSecret.reveal"
      : "secret.reveal",
  );
  const [busy, setBusy] = useState(false);
  const [replacements, setReplacements] = useState<Record<string, string>>({});
  const [deletedKeys, setDeletedKeys] = useState<string[]>([]);
  const [newEntries, setNewEntries] = useState<
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
  useLayoutEffect(() => {
    modeRequest.current++;
    setFileMode(false);
    setFileText("");
    setInitialFile("");
    originalValues.current.clear();
  }, [canReveal]);
  const keys = [...binding.keys].sort();
  const visibleKeys = keys.filter((key) => !deletedKeys.includes(key));
  const emptyStage = !fileMode && !keys.length && !newEntries.length;
  const hasChanges =
    (fileMode &&
      (fileText !== initialFile || Boolean(binding.missingKeys?.length))) ||
    Object.keys(replacements).length > 0 ||
    deletedKeys.length > 0 ||
    newEntries.length > 0;

  function fileChanges() {
    const values = parseSecretEnv(fileText);
    if (!canManageKeys) {
      const keyError = managedSecretKeyError(keys, values.keys());
      if (keyError) throw new Error(keyError);
    }
    const replacement: Record<string, string> = Object.create(null);
    for (const [key, value] of values) {
      if (value === "••••••••" && originalValues.current.get(key) !== value)
        throw new Error("Replace the masked value with a secret or reference");
      if (value !== originalValues.current.get(key)) replacement[key] = value;
    }
    return {
      set: replacement,
      delete: canManageKeys
        ? keys.filter((key) => !values.has(key))
        : ([] as string[]),
    };
  }

  async function toggleMode() {
    if (busy) return;
    const request = ++modeRequest.current;
    setBusy(true);
    try {
      if (fileMode) {
        const changes = fileChanges();
        setReplacements(
          Object.fromEntries(
            Object.entries(changes.set).filter(([key]) => keys.includes(key)),
          ),
        );
        setDeletedKeys(changes.delete);
        setNewEntries(
          Object.entries(changes.set)
            .filter(([key]) => !keys.includes(key))
            .map(([key, value]) => ({ id: crypto.randomUUID(), key, value })),
        );
        setFileText("");
        originalValues.current.clear();
      } else {
        const result =
          keys.length && canReveal
            ? await api.post<{
                values: Record<string, string>;
                revision: string | null;
              }>(
                `${endpoint}/${binding.environment}/${binding.stage}/reveal-all`,
                {},
              )
            : {
                values: Object.fromEntries(
                  keys
                    .filter((key) => !binding.missingKeys?.includes(key))
                    .map((key) => [key, "••••••••"]),
                ),
                revision: binding.revision,
              };
        if (request !== modeRequest.current) return;
        if (result.revision !== binding.revision)
          throw new Error("Secrets changed. Refresh before opening file mode.");
        const entries: Array<[string, string]> = [];
        const stored = new Map<string, string>();
        for (const key of keys) {
          if (
            !Object.hasOwn(result.values, key) &&
            !binding.missingKeys?.includes(key)
          )
            throw new Error(
              "Secrets changed. Refresh before opening file mode.",
            );
          if (Object.hasOwn(result.values, key))
            stored.set(key, result.values[key]!);
          if (!deletedKeys.includes(key))
            entries.push([
              key,
              Object.hasOwn(replacements, key)
                ? replacements[key]!
                : (result.values[key] ?? ""),
            ]);
        }
        entries.push(
          ...newEntries.map((entry): [string, string] => [
            entry.key,
            entry.value,
          ]),
        );
        const text = serializeSecretEnv(entries);
        const originalText = serializeSecretEnv(
          keys.map((key) => [key, result.values[key] ?? ""]),
        );
        parseSecretEnv(text);
        originalValues.current = stored;
        setFileText(text);
        setInitialFile(originalText);
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
    let mutation: { set: Record<string, string>; delete: string[] };
    try {
      if (fileMode) mutation = fileChanges();
      else {
        const added: Record<string, string> = Object.create(null);
        for (const entry of newEntries) {
          const key = entry.key.trim();
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key))
            throw new Error(
              "Variable names must start with a letter or underscore and contain only letters, numbers, and underscores.",
            );
          if (keys.includes(key) || Object.hasOwn(added, key))
            throw new Error(`Variable ${key} already exists.`);
          added[key] = entry.value;
        }
        mutation = {
          set: { ...replacements, ...added },
          delete: deletedKeys,
        };
      }
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Check the .env file.",
      );
      return;
    }
    if (!Object.keys(mutation.set).length && !mutation.delete.length) {
      setError("Change at least one secret.");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await api.patch(`${endpoint}/${binding.environment}/${binding.stage}`, {
        expectedRevision: binding.revision,
        ...mutation,
      });
      setReplacements({});
      setDeletedKeys([]);
      setNewEntries([]);
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

  function addVariable() {
    setNewEntries((current) => [
      ...current,
      { id: crypto.randomUUID(), key: "", value: "" },
    ]);
  }

  const stageLabel = stageLabels[binding.stage];
  return (
    <form onSubmit={submit}>
      <Widget className="min-w-0">
        <Widget.Header>
          <Widget.Title help={false}>{stageLabel} secrets</Widget.Title>
        </Widget.Header>
        <Widget.Content className="content-grid min-w-0">
          {fileMode && binding.missingKeys?.length ? (
            <FieldDescription>
              Required keys without saved values appear blank. Saving a blank
              value sets it to an intentionally empty string.
            </FieldDescription>
          ) : null}
          <Tabs
            selectedKey={fileMode ? "file" : "form"}
            onSelectionChange={(key) => {
              if ((key === "file") !== fileMode) void toggleMode();
            }}
          >
            <Tabs.ListContainer
              className={keys.length > 0 ? "mb-2 w-fit" : "hidden"}
            >
              <Tabs.List aria-label="Secret editing mode">
                <Tabs.Tab
                  id="form"
                  className="h-7 min-w-0 gap-1.5 px-3 text-xs"
                  isDisabled={busy}
                >
                  <HugeiconsIcon
                    aria-hidden="true"
                    icon={Menu01Icon}
                    size={14}
                  />
                  Form
                  <Tabs.Indicator />
                </Tabs.Tab>
                <Tabs.Tab
                  id="file"
                  className="h-7 min-w-0 gap-1.5 px-3 text-xs"
                  isDisabled={busy || !canManage}
                >
                  <HugeiconsIcon
                    aria-hidden="true"
                    icon={SourceCodeIcon}
                    size={14}
                  />
                  Editor
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
                    readOnlyLinePrefixes={
                      canManageKeys ? undefined : keys.map((key) => `${key}=`)
                    }
                  />
                </div>
              ) : null}
              {emptyStage ? (
                <EmptyState>
                  <EmptyState.Header>
                    <EmptyState.Title>
                      No {stageLabel.toLowerCase()} secrets
                    </EmptyState.Title>
                    <EmptyState.Description className="max-w-sm text-pretty">
                      {canManageKeys
                        ? "Add a variable to share it with workloads that reference it."
                        : "Declare required keys in the entity YAML and sync this environment."}
                    </EmptyState.Description>
                  </EmptyState.Header>
                  {canManage && canManageKeys ? (
                    <EmptyState.Content>
                      <Button
                        type="button"
                        variant="secondary"
                        isDisabled={busy}
                        onPress={addVariable}
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
              {!fileMode &&
              (visibleKeys.length > 0 || newEntries.length > 0) ? (
                <div className="grid gap-3">
                  {visibleKeys.map((key) => (
                    <div
                      key={key}
                      className="grid min-w-0 gap-2 sm:grid-cols-2"
                    >
                      <div className="flex min-h-10 min-w-0 items-center gap-2">
                        <span className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="break-all font-mono text-sm">
                            {key}
                          </span>
                          {binding.inheritedOrigins[key] ? (
                            <Chip
                              size="small"
                              tooltip={`This value comes from ${binding.inheritedOrigins[key]} and can be overridden here.`}
                              variant="secondary"
                            >
                              Inherited from {binding.inheritedOrigins[key]}
                            </Chip>
                          ) : binding.missingKeys?.includes(key) ? (
                            <Chip
                              size="small"
                              tooltip="This declared key does not have a saved value in the selected environment and stage."
                              variant="warning"
                            >
                              Missing
                            </Chip>
                          ) : null}
                        </span>
                        {canManageKeys ? (
                          <SecretRowDeleteButton
                            className="sm:hidden"
                            label={`Remove ${key}`}
                            disabled={!canManage || busy}
                            onPress={() =>
                              setDeletedKeys((current) => [...current, key])
                            }
                          />
                        ) : null}
                        <span
                          aria-hidden="true"
                          className="hidden min-w-0 flex-1 border-t border-dashed border-muted/50 lg:block"
                        />
                      </div>
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <SecretValueInput
                            label={`Value for ${key}`}
                            value={replacements[key] ?? ""}
                            configured={
                              !Object.hasOwn(replacements, key) &&
                              !binding.missingKeys?.includes(key)
                            }
                            disabled={!canManage || busy}
                            reveal={
                              canReveal
                                ? async () => {
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
                                  }
                                : undefined
                            }
                            onChange={(value) =>
                              setReplacements((current) => ({
                                ...current,
                                [key]: value,
                              }))
                            }
                          />
                        </div>
                        {canManageKeys ? (
                          <SecretRowDeleteButton
                            className="hidden sm:inline-flex"
                            label={`Remove ${key}`}
                            disabled={!canManage || busy}
                            onPress={() =>
                              setDeletedKeys((current) => [...current, key])
                            }
                          />
                        ) : null}
                      </div>
                    </div>
                  ))}
                  {newEntries.map((entry) => (
                    <div
                      key={entry.id}
                      className="grid min-w-0 gap-2 sm:grid-cols-2"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <Input
                          aria-label="Variable name"
                          className="min-w-0 flex-1 font-mono"
                          variant="secondary"
                          placeholder="VARIABLE_NAME"
                          autoComplete="off"
                          spellCheck={false}
                          value={entry.key}
                          disabled={!canManage || busy}
                          onChange={(event) => {
                            const value = event.currentTarget.value;
                            setNewEntries((current) =>
                              current.map((item) =>
                                item.id === entry.id
                                  ? { ...item, key: value }
                                  : item,
                              ),
                            );
                          }}
                        />
                        <SecretRowDeleteButton
                          className="sm:hidden"
                          label="Remove new variable"
                          disabled={!canManage || busy}
                          onPress={() =>
                            setNewEntries((current) =>
                              current.filter((item) => item.id !== entry.id),
                            )
                          }
                        />
                      </div>
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <SecretValueInput
                            label={`Value for ${entry.key || "new variable"}`}
                            value={entry.value}
                            disabled={!canManage || busy}
                            onChange={(value) =>
                              setNewEntries((current) =>
                                current.map((item) =>
                                  item.id === entry.id
                                    ? { ...item, value }
                                    : item,
                                ),
                              )
                            }
                          />
                        </div>
                        <SecretRowDeleteButton
                          className="hidden sm:inline-flex"
                          label="Remove new variable"
                          disabled={!canManage || busy}
                          onPress={() =>
                            setNewEntries((current) =>
                              current.filter((item) => item.id !== entry.id),
                            )
                          }
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
              {error ? (
                <FieldError className="whitespace-pre-line">{error}</FieldError>
              ) : null}
              {canManage &&
              !emptyStage &&
              (fileMode || keys.length > 0 || canManageKeys) ? (
                <div className="flex flex-wrap gap-2">
                  {!fileMode && canManageKeys ? (
                    <Button
                      type="button"
                      variant="secondary"
                      isDisabled={busy}
                      onPress={addVariable}
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

function SecretRowDeleteButton({
  className,
  label,
  disabled,
  onPress,
}: {
  className: string;
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Button
      type="button"
      isIconOnly
      variant="ghost"
      className={className}
      aria-label={label}
      isDisabled={disabled}
      onPress={onPress}
    >
      <HugeiconsIcon
        aria-hidden="true"
        icon={Delete02Icon}
        className="size-4 shrink-0"
      />
    </Button>
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
    if (!reveal) return;
    setLoading(true);
    try {
      const revealed = await reveal();
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
  const displayedValue = configured
    ? visible && reveal
      ? (stored ?? "")
      : ""
    : value;
  const hasReference =
    visible &&
    /\{\{\s*globals\.[A-Za-z_][A-Za-z0-9_]*\s*\}\}/u.test(displayedValue);
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
          configured ? (visible ? "" : "••••••••") : "Value or reference"
        }
        value={displayedValue}
        disabled={disabled || loading}
        onChange={(event) => {
          setStored(undefined);
          onChange(event.currentTarget.value);
        }}
      />
      <InputGroup.Suffix>
        {!configured || reveal ? (
          <Button
            type="button"
            isIconOnly
            variant="ghost"
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
        ) : null}
      </InputGroup.Suffix>
    </InputGroup>
  );
}
