"use client";

import { ViewIcon, ViewOffSlashIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";

import type {
  AppSecretBinding,
  AppSecretRevealResponse,
  AppSecretsResponse,
  Deployment,
} from "@workspace/towbar-web-client";
import { Button } from "@workspace/web-design-system/buttons/button";
import { EmptyState } from "@workspace/web-design-system/data-display/empty-state";
import { Table } from "@workspace/web-design-system/data-display/table";
import { Alert } from "@workspace/web-design-system/feedback/alert";
import { FieldError } from "@workspace/web-design-system/forms/field";
import { Input } from "@workspace/web-design-system/forms/input";
import { Tabs } from "@workspace/web-design-system/navigation/tabs";
import { toast } from "@workspace/web-design-system/overlays/toast";
import { Tooltip } from "@workspace/web-design-system/overlays/tooltip";
import { TypographyCode } from "@workspace/web-design-system/typography/typography";
import { cn } from "@workspace/web-design-system/lib/utils";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";

import { useApiQuery } from "@/hooks/use-api-query";
import { api } from "@/lib/api";

const environmentKeyPattern = /^[A-Za-z_][A-Za-z0-9_]*$/u;

type NewSecretKey = { id: string; key: string; value: string };
type SecretStageGroup = "build" | "deployment";

export function AppSecrets({
  appId,
  canDeploy,
  sourceId,
}: {
  appId: string;
  canDeploy: boolean;
  sourceId: string;
}) {
  const searchParams = useSearchParams();
  const active = searchParams.get("section") === "secrets";
  const query = useApiQuery<AppSecretsResponse>(
    active ? `/v1/core/apps/${appId}/secrets` : null,
  );

  if (!active) return null;
  if (query.error) return <QueryError message={query.error} />;
  if (!query.data) return <QueryLoading />;
  const data = query.data;
  if (data.bindings.length === 0) {
    return (
      <EmptyState>
        <EmptyState.Header>
          <EmptyState.Title>No secrets configured</EmptyState.Title>
          <EmptyState.Description>
            Add build or deployment secret references to .towbar/deployment.yml
            and sync this Source.
          </EmptyState.Description>
        </EmptyState.Header>
      </EmptyState>
    );
  }

  return (
    <Tabs className="block" defaultSelectedKey="build">
      <Tabs.ListContainer className="w-72 max-w-full">
        <Tabs.List className="w-full" aria-label="App secret stages">
          <Tabs.Tab id="build">
            Build
            <Tabs.Indicator />
          </Tabs.Tab>
          <Tabs.Tab id="deployment">
            Deployment
            <Tabs.Indicator />
          </Tabs.Tab>
        </Tabs.List>
      </Tabs.ListContainer>
      {(["build", "deployment"] as const).map((stage) => (
        <Tabs.Panel className="m-0 block p-0 pt-6" id={stage} key={stage}>
          <SecretStageEditor
            bindings={data.bindings}
            canDeploy={canDeploy}
            canManageSecrets={data.canManageSecrets}
            deployableId={appId}
            deployableType="app"
            endpoint={`/v1/core/apps/${appId}/secrets`}
            ownerId={appId}
            scope="app"
            sourceId={sourceId}
            stage={stage}
            onUpdated={query.refresh}
          />
        </Tabs.Panel>
      ))}
    </Tabs>
  );
}

export function ResourceSecrets({
  canDeploy,
  resourceId,
  sourceId,
}: {
  canDeploy: boolean;
  resourceId: string;
  sourceId: string;
}) {
  const searchParams = useSearchParams();
  const active = searchParams.get("section") === "secrets";
  const endpoint = `/v1/core/resources/${resourceId}/secrets`;
  const query = useApiQuery<AppSecretsResponse>(active ? endpoint : null);

  if (!active) return null;
  if (query.error) return <QueryError message={query.error} />;
  if (!query.data) return <QueryLoading />;
  if (query.data.bindings.length === 0) {
    return (
      <EmptyState>
        <EmptyState.Header>
          <EmptyState.Title>No secrets configured</EmptyState.Title>
          <EmptyState.Description>
            Add a deployment secret reference to .towbar/deployment.yml and sync
            this Source.
          </EmptyState.Description>
        </EmptyState.Header>
      </EmptyState>
    );
  }

  return (
    <SecretStageEditor
      bindings={query.data.bindings}
      canDeploy={canDeploy}
      canManageSecrets={query.data.canManageSecrets}
      deployableId={resourceId}
      deployableType="resource"
      endpoint={endpoint}
      ownerId={resourceId}
      scope="app"
      sourceId={sourceId}
      stage="deployment"
      onUpdated={query.refresh}
    />
  );
}

export function SourceSecrets({ sourceId }: { sourceId: string }) {
  const searchParams = useSearchParams();
  const active = searchParams.get("section") === "secrets";
  const endpoint = `/v1/core/sources/${sourceId}/secrets`;
  const query = useApiQuery<AppSecretsResponse>(active ? endpoint : null);

  if (!active) return null;
  if (query.error) return <QueryError message={query.error} />;
  if (!query.data) return <QueryLoading />;
  const data = query.data;
  if (data.bindings.length === 0) {
    return (
      <EmptyState>
        <EmptyState.Header>
          <EmptyState.Title>No shared secrets configured</EmptyState.Title>
          <EmptyState.Description>
            Add shared build or deployment secret references to
            .towbar/deployment.yml and sync this Source.
          </EmptyState.Description>
        </EmptyState.Header>
      </EmptyState>
    );
  }

  return (
    <Tabs className="block" defaultSelectedKey="build">
      <Tabs.ListContainer className="w-72 max-w-full">
        <Tabs.List className="w-full" aria-label="Shared Source secret stages">
          <Tabs.Tab id="build">
            Build
            <Tabs.Indicator />
          </Tabs.Tab>
          <Tabs.Tab id="deployment">
            Deployment
            <Tabs.Indicator />
          </Tabs.Tab>
        </Tabs.List>
      </Tabs.ListContainer>
      {(["build", "deployment"] as const).map((stage) => (
        <Tabs.Panel className="m-0 block p-0 pt-6" id={stage} key={stage}>
          <SecretStageEditor
            bindings={data.bindings}
            canDeploy={false}
            canManageSecrets={data.canManageSecrets}
            endpoint={endpoint}
            ownerId={sourceId}
            scope="shared"
            sourceId={sourceId}
            stage={stage}
            onUpdated={query.refresh}
          />
        </Tabs.Panel>
      ))}
    </Tabs>
  );
}

function SecretStageEditor({
  bindings,
  canDeploy,
  canManageSecrets,
  deployableId,
  deployableType,
  endpoint,
  onUpdated,
  ownerId,
  scope,
  sourceId,
  stage,
}: {
  bindings: AppSecretBinding[];
  canDeploy: boolean;
  canManageSecrets: boolean;
  deployableId?: string;
  deployableType?: "app" | "resource";
  endpoint: string;
  onUpdated: () => void;
  ownerId: string;
  scope: AppSecretBinding["uses"][number]["scope"];
  sourceId: string;
  stage: SecretStageGroup;
}) {
  const available = bindings.filter((binding) =>
    binding.uses.some(
      (use) => use.scope === scope && belongsToStage(use.stage, stage),
    ),
  );

  if (available.length === 0) {
    return (
      <EmptyState>
        <EmptyState.Header>
          <EmptyState.Title>No {stage} secrets configured</EmptyState.Title>
          <EmptyState.Description>
            Add a {stage} secret reference to .towbar/deployment.yml and sync
            this Source.
          </EmptyState.Description>
        </EmptyState.Header>
      </EmptyState>
    );
  }

  return (
    <div className="grid gap-10">
      {available.map((binding) => (
        <SecretVariablesEditor
          binding={binding}
          canDeploy={canDeploy}
          canManageSecrets={canManageSecrets}
          deployableId={deployableId}
          deployableType={deployableType}
          endpoint={endpoint}
          key={binding.reference}
          ownerId={ownerId}
          sourceId={sourceId}
          onUpdated={onUpdated}
        />
      ))}
    </div>
  );
}

function SecretVariablesEditor({
  binding,
  canDeploy,
  canManageSecrets,
  deployableId,
  deployableType,
  endpoint,
  onUpdated,
  ownerId,
  sourceId,
}: {
  binding: AppSecretBinding;
  canDeploy: boolean;
  canManageSecrets: boolean;
  deployableId?: string;
  deployableType?: "app" | "resource";
  endpoint: string;
  onUpdated: () => void;
  ownerId: string;
  sourceId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [showValues, setShowValues] = useState(false);
  const [revealed, setRevealed] = useState<AppSecretRevealResponse["secret"]>();
  const [deleted, setDeleted] = useState(() => new Set<string>());
  const [replacements, setReplacements] = useState<
    Record<string, string | undefined>
  >({});
  const [newKeys, setNewKeys] = useState<NewSecretKey[]>([]);
  const [validationError, setValidationError] = useState<string>();
  const canEdit =
    canManageSecrets && binding.editable && binding.status === "available";
  const formId = `secret-editor-${ownerId}-${binding.reference.replaceAll(/[^A-Za-z0-9_-]/gu, "-")}`;

  function addKey() {
    setNewKeys((current) => [
      ...current,
      { id: crypto.randomUUID(), key: "", value: "" },
    ]);
  }

  function toggleDelete(key: string) {
    setDeleted((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setReplacements((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  async function toggleValues() {
    if (showValues) {
      setShowValues(false);
      return;
    }
    if (revealed) {
      setShowValues(true);
      return;
    }
    setRevealing(true);
    try {
      const response = await api.post<AppSecretRevealResponse>(
        `${endpoint}/reveal`,
        { reference: binding.reference },
      );
      setRevealed(response.secret);
      setShowValues(true);
    } catch (error) {
      toast.danger(
        error instanceof Error
          ? error.message
          : "Secret values could not be revealed",
      );
    } finally {
      setRevealing(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit || !binding.versionId) return;
    const intent = (
      (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null
    )?.value;
    const set = Object.create(null) as Record<string, string>;
    for (const [key, value] of Object.entries(replacements)) {
      if (value !== undefined) set[key] = value;
    }
    const seen = new Set(binding.keys);
    for (const row of newKeys) {
      const key = row.key.trim();
      if (!environmentKeyPattern.test(key)) {
        setValidationError(
          "New keys must start with a letter or underscore and contain only letters, numbers, and underscores.",
        );
        return;
      }
      if (seen.has(key)) {
        setValidationError(`Secret key '${key}' is already present.`);
        return;
      }
      seen.add(key);
      set[key] = row.value;
    }
    if (deleted.size === 0 && Object.keys(set).length === 0) {
      setValidationError("Add, replace, or remove at least one variable.");
      return;
    }
    setValidationError(undefined);
    setBusy(true);
    try {
      await api.patch<{ secret: AppSecretBinding }>(endpoint, {
        delete: [...deleted],
        expectedVersionId: revealed?.versionId ?? binding.versionId,
        reference: binding.reference,
        set,
      });
      setDeleted(new Set());
      setReplacements({});
      setNewKeys([]);
      setRevealed(undefined);
      setShowValues(false);
      onUpdated();
      toast.success("Secret variables updated");
      if (intent === "save-and-deploy" && deployableId && deployableType) {
        try {
          const result = await api.post<{ deployment: Deployment }>(
            `/v1/core/${deployableType}s/${deployableId}/actions/deploy`,
            undefined,
            { "Idempotency-Key": crypto.randomUUID() },
          );
          toast.success("Deployment queued");
          router.push(
            `/sources/${sourceId}/deployments/${result.deployment.id}`,
          );
        } catch (error) {
          toast.danger(
            `Secret saved, but the deployment could not be queued: ${error instanceof Error ? error.message : "Request failed"}`,
          );
        }
      }
    } catch (error) {
      toast.danger(
        error instanceof Error ? error.message : "Secret could not be updated",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      <TypographyCode className="w-fit max-w-full break-all">
        {binding.reference}
      </TypographyCode>

      {binding.errorMessage ? (
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Secret unavailable</Alert.Title>
            <Alert.Description>{binding.errorMessage}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}
      {binding.status === "available" && !binding.editable ? (
        <Alert status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Binary secret</Alert.Title>
            <Alert.Description>
              Binary AWS secrets cannot be edited through Towbar.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      <form className="grid gap-4" id={formId} onSubmit={submit}>
        {validationError ? <FieldError>{validationError}</FieldError> : null}
        <Table>
          <Table.ScrollContainer>
            <Table.Content aria-label="Secret variables">
              <Table.Header>
                <Table.Column isRowHeader>Variable</Table.Column>
                <Table.Column>
                  <span className="flex items-center justify-between gap-2">
                    Value
                    {canManageSecrets && binding.status === "available" ? (
                      <Tooltip>
                        <Button
                          aria-label={
                            showValues
                              ? "Hide secret values"
                              : "Reveal secret values"
                          }
                          isDisabled={revealing}
                          isIconOnly
                          size="sm"
                          variant="ghost"
                          onPress={toggleValues}
                        >
                          <HugeiconsIcon
                            aria-hidden="true"
                            icon={showValues ? ViewIcon : ViewOffSlashIcon}
                          />
                        </Button>
                        <Tooltip.Content>
                          {showValues
                            ? "Hide secret values"
                            : "Reveal secret values"}
                        </Tooltip.Content>
                      </Tooltip>
                    ) : null}
                  </span>
                </Table.Column>
                <Table.Column>Action</Table.Column>
              </Table.Header>
              <Table.Body>
                {binding.keys.map((key) => {
                  const isDeleted = deleted.has(key);
                  const isEdited = Object.hasOwn(replacements, key);
                  return (
                    <Table.Row id={`existing-${key}`} key={key}>
                      <Table.Cell>
                        <TypographyCode
                          className={
                            isDeleted ? "line-through opacity-60" : undefined
                          }
                        >
                          {key}
                        </TypographyCode>
                      </Table.Cell>
                      <Table.Cell className="min-w-64">
                        <Input
                          aria-label={`Value for ${key}`}
                          autoComplete="new-password"
                          className={cn(
                            "w-full",
                            isEdited &&
                              "bg-warning-soft text-warning-soft-foreground",
                          )}
                          disabled={busy || isDeleted}
                          placeholder={revealed ? undefined : "Unchanged"}
                          readOnly={!canEdit}
                          spellCheck={false}
                          type={showValues ? "text" : "password"}
                          value={
                            replacements[key] ?? revealed?.values[key] ?? ""
                          }
                          variant="secondary"
                          onChange={(event) => {
                            const value = event.currentTarget.value;
                            setReplacements((current) => ({
                              ...current,
                              [key]: value,
                            }));
                          }}
                        />
                      </Table.Cell>
                      <Table.Cell className="whitespace-nowrap">
                        {canEdit ? (
                          <Button
                            isDisabled={busy}
                            size="sm"
                            variant={isDeleted ? "secondary" : "danger"}
                            onPress={() => toggleDelete(key)}
                          >
                            {isDeleted ? "Keep" : "Remove"}
                          </Button>
                        ) : (
                          "—"
                        )}
                      </Table.Cell>
                    </Table.Row>
                  );
                })}
                {newKeys.map((row, index) => (
                  <Table.Row id={`new-${row.id}`} key={row.id}>
                    <Table.Cell className="min-w-52">
                      <Input
                        aria-label={`New variable ${index + 1} name`}
                        autoComplete="off"
                        className="w-full"
                        disabled={busy}
                        placeholder="VARIABLE_NAME"
                        spellCheck={false}
                        value={row.key}
                        variant="secondary"
                        onChange={(event) => {
                          const value = event.currentTarget.value;
                          setNewKeys((current) =>
                            current.map((candidate) =>
                              candidate.id === row.id
                                ? {
                                    ...candidate,
                                    key: value,
                                  }
                                : candidate,
                            ),
                          );
                        }}
                      />
                    </Table.Cell>
                    <Table.Cell className="min-w-64">
                      <Input
                        aria-label={`Value for new variable ${index + 1}`}
                        autoComplete="new-password"
                        className="bg-warning-soft text-warning-soft-foreground w-full"
                        disabled={busy}
                        spellCheck={false}
                        type={showValues ? "text" : "password"}
                        value={row.value}
                        variant="secondary"
                        onChange={(event) => {
                          const value = event.currentTarget.value;
                          setNewKeys((current) =>
                            current.map((candidate) =>
                              candidate.id === row.id
                                ? {
                                    ...candidate,
                                    value,
                                  }
                                : candidate,
                            ),
                          );
                        }}
                      />
                    </Table.Cell>
                    <Table.Cell>
                      <Button
                        isDisabled={busy}
                        size="sm"
                        variant="danger"
                        onPress={() =>
                          setNewKeys((current) =>
                            current.filter(
                              (candidate) => candidate.id !== row.id,
                            ),
                          )
                        }
                      >
                        Remove
                      </Button>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>

        {canEdit ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button
              isDisabled={busy || newKeys.length >= 200}
              variant="secondary"
              onPress={addKey}
            >
              Add variable
            </Button>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                form={formId}
                isDisabled={busy}
                type="submit"
                value="save"
                variant={canDeploy ? "secondary" : "primary"}
              >
                {busy ? "Saving…" : "Save changes"}
              </Button>
              {canDeploy ? (
                <Button
                  form={formId}
                  isDisabled={busy}
                  type="submit"
                  value="save-and-deploy"
                >
                  {busy ? "Saving…" : "Save and deploy"}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </form>
    </div>
  );
}

function belongsToStage(
  stage: AppSecretBinding["uses"][number]["stage"],
  group: SecretStageGroup,
) {
  return group === "build" ? stage === "build" : stage !== "build";
}
