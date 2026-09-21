"use client";

import { FieldDescription } from "@workspace/web-design-system/forms/field";
import {
  TableCellStack,
  TableCellDescription,
} from "@workspace/towbar-web-ui/table-cell-text";

import { type KeyScope, type KeyAccess } from "@workspace/towbar-access";
import { useAccess } from "./access-context";
import { PageSelectionTitle } from "./page-selection-title";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  BookOpen01Icon,
  Key01Icon,
  Add01Icon,
  ShieldBanIcon,
} from "@hugeicons/core-free-icons";
import {
  useId,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Button,
  ButtonLink,
} from "@workspace/web-design-system/buttons/button";
import { Input } from "@workspace/web-design-system/forms/input";
import { Label } from "@workspace/web-design-system/forms/label";
import { Select, ListBox } from "@workspace/web-design-system/forms/select";
import { Modal } from "@workspace/web-design-system/overlays/modal";
import { toast } from "@workspace/web-design-system/overlays/toast";
import { CodeBlock } from "@workspace/web-design-system/typography/code-block";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import {
  ResourceTable,
  type ResourceTableColumn,
} from "@workspace/towbar-web-ui/resource-table";
import { StatusBadge } from "@workspace/towbar-web-ui/status-badge";
import { useApiQuery } from "@/hooks/use-api-query";
import { api } from "@/lib/api";
import { ActionButton, FormCard } from "./page-parts";
import { RelativeTime } from "./last-synced-time";
import { McpClientLogo } from "./mcp-client-logo";
import { PrivateKeyStore } from "./private-key-store";

type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  access: KeyAccess;
  includeAdmin: boolean;
  scope: KeyScope;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
};
type KeySettings = {
  keys: ApiKey[];
  apiUrl: string;
  mcpUrl: string;
  rateLimit: { requests: number; windowSeconds: number };
};
const baseEndpoint = "/v1/core/settings/api-keys";

function RevealedSecret({ title, code }: { title: string; code: string }) {
  return (
    <CodeBlock>
      <CodeBlock.Header>
        <CodeBlock.Filename>{title}</CodeBlock.Filename>
        <CodeBlock.CopyButton code={code} />
      </CodeBlock.Header>
      <CodeBlock.Code code={code} />
    </CodeBlock>
  );
}
function Choice({
  label,
  value,
  onChange,
  options,
  renderIcon,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<[string, string, string?]>;
  renderIcon?: (id: string) => ReactNode;
}) {
  return (
    <Select
      fullWidth
      isRequired
      variant="secondary"
      selectedKey={value}
      onSelectionChange={(key) => {
        if (key !== null) onChange(String(key));
      }}
    >
      <Label isRequired>{label}</Label>
      <Select.Trigger className="items-center">
        <Select.Value className="flex items-center">
          {renderIcon ? (
            <span className="flex items-center gap-2">
              {renderIcon(value)}
              {options.find(([id]) => id === value)?.[1]}
            </span>
          ) : (
            options.find(([id]) => id === value)?.[1]
          )}
        </Select.Value>
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover className="w-(--trigger-width)">
        <ListBox>
          {options.map(([id, name, description]) => (
            <ListBox.Item key={id} id={id} textValue={name}>
              <div className="grid min-w-0 flex-1 gap-1 pr-3">
                <span className="inline-flex items-center gap-2 font-medium">
                  {renderIcon?.(id)}
                  {name}
                </span>
                {description ? (
                  <span className="text-xs leading-relaxed font-normal text-muted whitespace-normal">
                    {description}
                  </span>
                ) : null}
              </div>
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

export type KeyStoreSection =
  "private-keys" | "personal-keys" | "team-keys" | "mcp";
export function ApiMcpSettings({ section }: { section: KeyStoreSection }) {
  const scope: KeyScope = section === "team-keys" ? "team" : "personal";
  const endpoint = `${baseEndpoint}/${scope}`;
  const isKeyPage = section === "personal-keys" || section === "team-keys";
  const query = useApiQuery<KeySettings>(isKeyPage ? endpoint : null);
  const guide = useApiQuery<KeySettings>(
    section === "mcp" ? `${baseEndpoint}/personal` : null,
  );
  const [creatingPrivateKey, setCreatingPrivateKey] = useState(false);
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [revealOpen, setRevealOpen] = useState(false);
  const [formInstance, setFormInstance] = useState(0);
  const actions = useMemo(
    () =>
      section === "private-keys" ? (
        <Button onPress={() => setCreatingPrivateKey(true)}>
          <HugeiconsIcon icon={Add01Icon} className="size-4" />
          Add private key
        </Button>
      ) : isKeyPage ? (
        <Button
          onPress={() => {
            setFormInstance((value) => value + 1);
            setCreating(true);
          }}
        >
          <HugeiconsIcon icon={Add01Icon} className="size-4" />
          Create API key
        </Button>
      ) : undefined,
    [section, isKeyPage],
  );
  const sectionLabels: Record<KeyStoreSection, string> = {
    "private-keys": "SSH keys",
    "personal-keys": "API Keys",
    "team-keys": "API Keys",
    mcp: "MCP Guide",
  };
  const columns: ResourceTableColumn<ApiKey>[] = [
    {
      key: "name",
      header: "Key",
      className: "min-w-52",
      cell: (key) => (
        <TableCellStack as="div">
          <span>{key.name}</span>
          <TableCellDescription className="font-mono">
            {key.prefix}••••
          </TableCellDescription>
        </TableCellStack>
      ),
    },
    {
      key: "access",
      header: "Permissions",
      cell: (key) =>
        key.access === "read"
          ? "Read-only"
          : key.includeAdmin
            ? "Administrative"
            : "Edit",
    },
    {
      key: "used",
      header: "Last used",
      cell: (key) =>
        key.lastUsedAt ? (
          <RelativeTime label="Last used" value={key.lastUsedAt} />
        ) : (
          <span className="text-muted">Never</span>
        ),
    },
    {
      key: "expires",
      header: "Expires",
      cell: (key) =>
        key.expiresAt ? (
          <RelativeTime label="Expires" value={key.expiresAt} />
        ) : (
          "No expiry"
        ),
    },
    {
      key: "status",
      header: "Status",
      cell: (key) => (
        <StatusBadge
          status={
            key.revokedAt
              ? "revoked"
              : key.expiresAt && Date.parse(key.expiresAt) <= Date.now()
                ? "expired"
                : "active"
          }
        />
      ),
    },
    {
      key: "actions",
      header: "",
      cell: (key) =>
        !key.revokedAt ? (
          <ActionButton
            action={async () => {
              await api.delete(`${endpoint}/${key.id}`);
              query.refresh();
            }}
            confirm={{
              title: `Revoke ${key.name}?`,
              description:
                "Any script or MCP client using this key will lose access immediately. Create a replacement key to reconnect.",
              actionLabel: "Revoke key",
            }}
            variant="danger"
            success="Key revoked"
          >
            <HugeiconsIcon
              aria-hidden="true"
              icon={ShieldBanIcon}
              className="shrink-0"
            />
            Revoke
          </ActionButton>
        ) : null,
    },
  ];

  return (
    <div className="content-grid">
      <PageSelectionTitle label={sectionLabels[section]} actions={actions} />
      {section === "private-keys" ? (
        <PrivateKeyStore
          createOpen={creatingPrivateKey}
          onCreateOpenChange={setCreatingPrivateKey}
        />
      ) : isKeyPage ? (
        query.error ? (
          <QueryError message={query.error} />
        ) : !query.data ? (
          <QueryLoading />
        ) : (
          <>
            <p className="text-muted text-sm">
              {scope === "team"
                ? "Team keys represent this workspace and remain active until revoked or expired."
                : "Personal keys are limited by your current role and the permissions granted when they were created."}
            </p>
            <ResourceTable
              ariaLabel={sectionLabels[section]}
              columns={columns}
              items={query.data.keys}
              getRowKey={(key) => key.id}
              emptyTitle="No API keys yet"
              emptyDescription="Create a key for your scripts or MCP client. Its token is shown once."
            />
          </>
        )
      ) : guide.error ? (
        <QueryError message={guide.error} />
      ) : !guide.data ? (
        <QueryLoading />
      ) : (
        <McpSetup url={guide.data.mcpUrl} />
      )}
      <Modal.Backdrop isOpen={creating} onOpenChange={setCreating}>
        <Modal.Container size="sm" scroll="inside">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>Create API key</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <CreateKey
                key={formInstance}
                scope={scope}
                onCancel={() => setCreating(false)}
                onCreated={(token) => {
                  setCreating(false);
                  setRevealed(token);
                  setRevealOpen(true);
                  query.refresh();
                }}
              />
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
      <Modal.Backdrop isOpen={revealOpen} onOpenChange={setRevealOpen}>
        <Modal.Container size="md">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>
                {revealed ? "Copy your API key" : "Key already created"}
              </Modal.Heading>
            </Modal.Header>
            <Modal.Body className="content-grid">
              <p>
                {revealed
                  ? "Save this token in a secret manager. You won’t be able to view it again."
                  : "This request already created a key. Its token can only be shown in the original response. Revoke it and create a replacement if you did not save it."}
              </p>
              {revealed ? (
                <RevealedSecret title="Your new key" code={revealed} />
              ) : null}
              <Button onPress={() => setRevealOpen(false)}>Done</Button>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </div>
  );
}

function CreateKey({
  scope,
  onCreated,
  onCancel,
}: {
  scope: KeyScope;
  onCancel: () => void;
  onCreated: (token: string | null) => void;
}) {
  const { user } = useAccess();
  const [request, setRequest] = useState<{ id: string; body: string } | null>(
    null,
  );
  const endpoint = `${baseEndpoint}/${scope}`;
  const nameId = useId();
  const [permission, setPermission] = useState("read");
  const [expiry, setExpiry] = useState("90");
  const expiresAt = useMemo(
    () =>
      expiry === "never"
        ? null
        : new Date(Date.now() + Number(expiry) * 86400000).toISOString(),
    [expiry],
  );
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const body = {
        name: String(form.get("name") ?? ""),
        access: permission === "read" ? "read" : "edit",
        includeAdmin: permission === "admin",
        expiresAt,
      };
      const serialized = JSON.stringify(body);
      const nextRequest =
        request?.body === serialized
          ? request
          : { id: crypto.randomUUID(), body: serialized };
      setRequest(nextRequest);
      const result = await api.post<{ token: string | null }>(endpoint, body, {
        "Idempotency-Key": nextRequest.id,
      });
      onCreated(result.token);
    } catch (caught) {
      toast.danger(
        caught instanceof Error ? caught.message : "Could not create key",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="content-grid">
      <div className="flex flex-col gap-2">
        <Label htmlFor={nameId} isRequired>
          Name
        </Label>
        <Input
          id={nameId}
          name="name"
          required
          maxLength={120}
          placeholder="e.g. Cursor on my Mac"
          variant="secondary"
          autoComplete="off"
        />
      </div>
      <Choice
        label="Permissions"
        value={permission}
        onChange={setPermission}
        options={[
          [
            "read",
            "Read-only",
            "View repositories, deployments, resources, and monitoring data.",
          ],
          ...(user?.workspaceRole === "admin" ||
          user?.workspaceRole === "member"
            ? [
                [
                  "edit",
                  "Edit",
                  "Manage repositories, update secrets, and configure Scout within your role.",
                ] as [string, string, string],
              ]
            : []),
          ...(user?.workspaceRole === "admin"
            ? [
                [
                  "admin",
                  "Administrative",
                  "Edit access plus deployment, infrastructure, and integration management. Account settings and credential reveal remain browser-only.",
                ] as [string, string, string],
              ]
            : []),
        ]}
      />
      <Choice
        label="Expires after"
        value={expiry}
        onChange={setExpiry}
        options={[
          ["30", "30 days"],
          ["90", "90 days"],
          ["365", "1 year"],
          ...(user?.workspaceRole === "admin"
            ? [["never", "Never"] as [string, string]]
            : []),
        ]}
      />
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          isDisabled={busy}
          onPress={onCancel}
        >
          Cancel
        </Button>
        <Button type="submit" isDisabled={busy}>
          <HugeiconsIcon
            aria-hidden="true"
            icon={Key01Icon}
            className="size-4 shrink-0"
          />
          {busy ? "Creating…" : "Create key"}
        </Button>
      </div>
    </form>
  );
}

function McpSetup({ url }: { url: string }) {
  const [client, setClient] = useState("cursor");
  const configs = {
    codex: {
      title: "~/.codex/config.toml",
      code: `[mcp_servers.towbar]\nurl = ${JSON.stringify(url)}\nbearer_token_env_var = "TOWBAR_API_KEY"`,
    },
    cursor: {
      title: ".cursor/mcp.json",
      code: JSON.stringify(
        {
          mcpServers: {
            towbar: {
              url,
              headers: { Authorization: "Bearer YOUR_TOWBAR_API_KEY" },
            },
          },
        },
        null,
        2,
      ),
    },
    vscode: {
      title: ".vscode/mcp.json",
      code: JSON.stringify(
        {
          inputs: [
            {
              type: "promptString",
              id: "towbar-key",
              description: "Towbar API key",
              password: true,
            },
          ],
          servers: {
            towbar: {
              type: "http",
              url,
              headers: { Authorization: "Bearer ${input:towbar-key}" },
            },
          },
        },
        null,
        2,
      ),
    },
    claude: {
      title: "Claude Code",
      code: `claude mcp add --transport http towbar '${url}' \\\n  --header "Authorization: Bearer $TOWBAR_API_KEY"`,
    },
    other: {
      title: "Connection details",
      code: `Transport: Streamable HTTP\nURL: ${url}\nAuthorization: Bearer YOUR_TOWBAR_API_KEY`,
    },
  };
  const config = configs[client as keyof typeof configs]!;
  return (
    <FormCard title="Connect your MCP client">
      <div className="content-grid">
        <div className="max-w-sm">
          <Choice
            label="Client"
            value={client}
            onChange={setClient}
            renderIcon={(id) => <McpClientLogo client={id} />}
            options={[
              ["codex", "Codex"],
              ["cursor", "Cursor"],
              ["vscode", "VS Code"],
              ["claude", "Claude Code"],
              ["other", "Other clients"],
            ]}
          />
        </div>
        <RevealedSecret title={config.title} code={config.code} />
        {client === "codex" ? (
          <div className="text-xs leading-relaxed font-normal text-muted">
            Set{" "}
            <pre className="inline whitespace-nowrap rounded bg-default px-1 py-0.25 text-foreground">
              <code>TOWBAR_API_KEY</code>
            </pre>{" "}
            to your key in the environment that launches Codex, then restart it.
            The configuration stores the variable name, not the key. In the CLI,
            use{" "}
            <code className="rounded bg-default px-1 py-0.25 text-foreground">
              /mcp
            </code>{" "}
            to check the connection.
          </div>
        ) : null}
        <FieldDescription>
          Choose a client that supports Streamable HTTP and bearer headers.
          Towbar uses API keys; browser-only OAuth connectors cannot connect
          directly.
        </FieldDescription>
        <ButtonLink
          href="https://www.towbar.dev/docs/api/mcp"
          variant="secondary"
          className="w-fit"
        >
          <HugeiconsIcon
            aria-hidden="true"
            icon={BookOpen01Icon}
            className="size-4 shrink-0"
          />
          MCP setup and troubleshooting
        </ButtonLink>
      </div>
    </FormCard>
  );
}
