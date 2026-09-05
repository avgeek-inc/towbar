"use client";
import { useId, useState, type FormEvent } from "react";
import {
  Button,
  ButtonLink,
} from "@workspace/web-design-system/buttons/button";
import { Input } from "@workspace/web-design-system/forms/input";
import { Label } from "@workspace/web-design-system/forms/label";
import { Select, ListBox } from "@workspace/web-design-system/forms/select";
import { Modal } from "@workspace/web-design-system/overlays/modal";
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
import { ResponsiveSubtabs } from "./responsive-subtabs";

type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  access: "read" | "write";
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
const endpoint = "/v1/core/settings/api-keys";

function SetupCode({ title, code }: { title: string; code: string }) {
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
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <Select
      fullWidth
      variant="secondary"
      selectedKey={value}
      onSelectionChange={(key) => {
        if (key !== null) onChange(String(key));
      }}
    >
      <Label>{label}</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {options.map(([id, name]) => (
            <ListBox.Item key={id} id={id} textValue={name}>
              {name}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

export function ApiMcpSettings() {
  const query = useApiQuery<KeySettings>(endpoint);
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  if (query.error) return <QueryError message={query.error} />;
  if (!query.data) return <QueryLoading />;
  const data = query.data;
  const columns: ResourceTableColumn<ApiKey>[] = [
    {
      key: "name",
      header: "Key",
      className: "min-w-52",
      cell: (key) => (
        <div className="flex flex-col gap-0.5">
          <span>{key.name}</span>
          <span className="text-muted text-sm font-mono">{key.prefix}••••</span>
        </div>
      ),
    },
    {
      key: "access",
      header: "Permissions",
      cell: (key) => (key.access === "read" ? "Read only" : "Full access"),
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
            Revoke
          </ActionButton>
        ) : null,
    },
  ];
  return (
    <div className="content-grid">
      <ResponsiveSubtabs
        ariaLabel="API & MCP sections"
        defaultSelectedKey="keys"
        layout="sidebar"
        tabs={[
          {
            value: "keys",
            label: "API Keys",
            content: (
              <div className="content-grid">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <p className="text-muted max-w-2xl">
                    Connect scripts and AI tools to your control plane. Each key
                    works with both interfaces and uses your current workspace
                    permissions and can be revoked at any time.
                  </p>
                  <Button onPress={() => setCreating(true)}>
                    Create API key
                  </Button>
                </div>
                <ResourceTable
                  ariaLabel="API keys"
                  columns={columns}
                  items={data.keys}
                  getRowKey={(key) => key.id}
                  emptyTitle="No API keys yet"
                  emptyDescription="Create a key for your scripts or MCP client. The secret is only shown once."
                />
                <p className="text-muted text-sm">
                  API and MCP share a limit of {data.rateLimit.requests}{" "}
                  requests per {data.rateLimit.windowSeconds} seconds from each
                  IP address.
                </p>
              </div>
            ),
          },
          {
            value: "mcp",
            label: "MCP Guide",
            content: <McpSetup url={data.mcpUrl} />,
          },
          {
            value: "api",
            label: "API Guide",
            content: (
              <div className="content-grid">
                <SetupCode
                  title="List your apps"
                  code={`curl '${data.apiUrl}/apps' \\\n  -H "Authorization: Bearer $TOWBAR_API_KEY"`}
                />
                <ButtonLink
                  href="https://www.towbar.dev/docs/api/overview"
                  variant="secondary"
                  className="w-fit"
                >
                  API documentation and route reference →
                </ButtonLink>
              </div>
            ),
          },
        ]}
      />
      <Modal isOpen={creating} onOpenChange={setCreating}>
        <Modal.Backdrop>
          <Modal.Container size="sm" scroll="inside">
            <Modal.Dialog>
              <Modal.CloseTrigger />
              <Modal.Header>
                <Modal.Heading>Create API key</Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                <CreateKey
                  onCreated={(token) => {
                    setCreating(false);
                    setRevealed(token);
                    query.refresh();
                  }}
                />
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      <Modal
        isOpen={revealed !== null}
        onOpenChange={(open) => {
          if (!open) setRevealed(null);
        }}
      >
        <Modal.Backdrop>
          <Modal.Container size="md">
            <Modal.Dialog>
              <Modal.CloseTrigger />
              <Modal.Header>
                <Modal.Heading>Copy your API key</Modal.Heading>
              </Modal.Header>
              <Modal.Body className="content-grid">
                <p>
                  Save this key in a secret manager now. Towbar stores only its
                  hash, so you won’t be able to view it again.
                </p>
                {revealed ? (
                  <SetupCode title="Your new key" code={revealed} />
                ) : null}
                <Button onPress={() => setRevealed(null)}>Done</Button>
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  );
}

function CreateKey({ onCreated }: { onCreated: (token: string) => void }) {
  const nameId = useId();
  const [access, setAccess] = useState("read");
  const [expiry, setExpiry] = useState("90");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(undefined);
    try {
      const result = await api.post<{ token: string }>(endpoint, {
        name: String(form.get("name") ?? ""),
        access,
        expiresAt:
          expiry === "never"
            ? null
            : new Date(Date.now() + Number(expiry) * 86400000).toISOString(),
      });
      onCreated(result.token);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not create key",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="content-grid">
      {error ? (
        <p role="alert" className="text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        <Label htmlFor={nameId}>Name</Label>
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
        value={access}
        onChange={setAccess}
        options={[
          ["read", "Read only"],
          ["write", "Full access"],
        ]}
      />
      <p className="text-muted text-sm">
        {access === "read"
          ? "View workloads, status, logs, and configuration. Cannot make changes."
          : "Can deploy, change settings, manage secrets, and perform destructive actions allowed by your workspace role."}
      </p>
      <Choice
        label="Expires after"
        value={expiry}
        onChange={setExpiry}
        options={[
          ["30", "30 days"],
          ["90", "90 days"],
          ["365", "1 year"],
          ["never", "Never"],
        ]}
      />
      <Button type="submit" isDisabled={busy}>
        {busy ? "Creating…" : "Create key"}
      </Button>
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
            options={[
              ["codex", "Codex"],
              ["cursor", "Cursor"],
              ["vscode", "VS Code"],
              ["claude", "Claude Code"],
              ["other", "Other clients"],
            ]}
          />
        </div>
        <SetupCode title={config.title} code={config.code} />
        {client === "codex" ? (
          <p className="text-muted text-sm">
            Set TOWBAR_API_KEY to your key in the environment that launches
            Codex, then restart it. The configuration stores the variable name,
            not the key. In the CLI, use /mcp to check the connection.
          </p>
        ) : null}
        <p className="text-muted text-sm">
          Choose a client that supports Streamable HTTP and bearer headers.
          Towbar uses API keys; browser-only OAuth connectors cannot connect
          directly.
        </p>
        <ButtonLink
          href="https://www.towbar.dev/docs/api/mcp"
          variant="secondary"
          className="w-fit"
        >
          MCP setup and troubleshooting →
        </ButtonLink>
      </div>
    </FormCard>
  );
}
