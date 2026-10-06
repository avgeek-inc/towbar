"use client";
import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, MoreHorizontalIcon } from "@hugeicons/core-free-icons";
import { Button } from "@workspace/web-design-system/buttons/button";
import { Modal } from "@workspace/web-design-system/overlays/modal";
import { Dropdown } from "@workspace/web-design-system/overlays/dropdown";
import { Label } from "@workspace/web-design-system/forms/label";
import { CodeBlock } from "@workspace/web-design-system/typography/code-block";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { ResourceTable } from "@workspace/towbar-web-ui/resource-table";
import { ActionButton } from "./page-parts";
import { PageSelectionTitle } from "./page-selection-title";
import { AuthForm } from "./auth-form";
import { useAccess } from "./access-context";
import { refreshApiQueries, useApiQuery } from "@/hooks/use-api-query";
import { api } from "@/lib/api";
import { displayDate } from "@/lib/date-time-display";
import { registerPasskey, passkeyError } from "@/lib/passkeys";

type Passkey = { id: string; name: string | null; createdAt: string };
export function PasskeySettings() {
  const { user } = useAccess();
  const keys = useApiQuery<{ passkeys: Passkey[] }>(
    "/v1/core/profile/passkeys",
  );
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Passkey | null>(null);
  const [instance, setInstance] = useState(0);
  const [replace, setReplace] = useState(false);
  const [codes, setCodes] = useState<string[]>([]);
  function changed() {
    refreshApiQueries();
    keys.refresh();
    window.dispatchEvent(new Event("towbar:identity-changed"));
  }
  function edit(key: Passkey | null) {
    setEditing(key);
    setInstance((v) => v + 1);
    setOpen(true);
  }
  return (
    <>
      <PageSelectionTitle
        label="Passkeys"
        actions={
          <div className="flex items-center gap-2">
            <Button onPress={() => edit(null)}>
              <HugeiconsIcon
                icon={Add01Icon}
                className="size-4"
                aria-hidden="true"
              />
              Add passkey
            </Button>
            {keys.data?.passkeys.length ? (
              <Dropdown>
                <Button
                  variant="secondary"
                  isIconOnly
                  aria-label="More passkey actions"
                >
                  <HugeiconsIcon icon={MoreHorizontalIcon} aria-hidden="true" />
                </Button>
                <Dropdown.Popover>
                  <Dropdown.Menu
                    aria-label="Passkey actions"
                    onAction={() => setReplace(true)}
                  >
                    <Dropdown.Item
                      id="recovery"
                      textValue="Replace recovery codes"
                    >
                      <Label>Replace recovery codes</Label>
                    </Dropdown.Item>
                  </Dropdown.Menu>
                </Dropdown.Popover>
              </Dropdown>
            ) : null}
          </div>
        }
      />
      {keys.error ? (
        <QueryError message={keys.error} />
      ) : !keys.data ? (
        <QueryLoading />
      ) : (
        <ResourceTable<Passkey>
          ariaLabel="Passkeys"
          getRowKey={(key) => key.id}
          items={keys.data.passkeys}
          emptyTitle="No passkeys added"
          emptyDescription=""
          columns={[
            {
              key: "name",
              header: "Name",
              cell: (key) => key.name || "Passkey",
            },
            {
              key: "created",
              header: "Created",
              cell: (key) => (
                <time dateTime={key.createdAt}>
                  {displayDate(key.createdAt)}
                </time>
              ),
            },
            {
              key: "actions",
              header: "Actions",
              headerClassName: "text-right",
              className: "text-right",
              cell: (key) => (
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" onPress={() => edit(key)}>
                    Rename
                  </Button>
                  <ActionButton
                    variant="danger"
                    success="Passkey removed"
                    confirm={{
                      title: "Remove passkey?",
                      description: key.name || "Passkey",
                      actionLabel: "Remove",
                    }}
                    action={async () => {
                      await api.post(
                        "/v1/public/auth/identity/passkey/delete-passkey",
                        { id: key.id },
                      );
                      changed();
                    }}
                  >
                    Remove
                  </ActionButton>
                </div>
              ),
            },
          ]}
        />
      )}
      <Modal.Backdrop isOpen={open} onOpenChange={setOpen}>
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>
                {editing ? "Rename passkey" : "Add passkey"}
              </Modal.Heading>
              <Modal.CloseTrigger />
            </Modal.Header>
            <Modal.Body>
              <AuthForm
                key={instance}
                variant="secondary"
                errorPresentation="toast"
                fields={[
                  {
                    name: "name",
                    label: "Name",
                    required: true,
                    maxLength: 120,
                    defaultValue: editing?.name ?? "",
                    autoComplete: "off",
                  },
                ]}
                submitLabel={editing ? "Update" : "Continue"}
                onCancel={() => setOpen(false)}
                onSubmit={async (values) => {
                  try {
                    if (editing)
                      await api.post(
                        "/v1/public/auth/identity/passkey/update-passkey",
                        { id: editing.id, name: values.name },
                      );
                    else {
                      if (!user) throw new Error("Sign in to add a passkey.");
                      const result = await registerPasskey(
                        values.name ?? "",
                        user.email,
                      );
                      if (result.recoveryCodes) setCodes(result.recoveryCodes);
                    }
                  } catch (error) {
                    throw new Error(passkeyError(error));
                  }
                  setOpen(false);
                  changed();
                }}
              />
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
      <Modal.Backdrop isOpen={replace} onOpenChange={setReplace}>
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>Replace recovery codes?</Modal.Heading>
              <Modal.CloseTrigger />
            </Modal.Header>
            <Modal.Body>
              <p className="text-sm text-muted">
                Your previous recovery codes will stop working.
              </p>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="secondary" onPress={() => setReplace(false)}>
                Cancel
              </Button>
              <ActionButton
                success="Recovery codes replaced"
                action={async () => {
                  const result = await api.post<{ recoveryCodes: string[] }>(
                    "/v1/core/profile/passkeys/recovery-codes",
                    {},
                  );
                  setReplace(false);
                  setCodes(result.recoveryCodes);
                }}
              >
                Replace
              </ActionButton>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
      <RecoveryCodes codes={codes} onClose={() => setCodes([])} />
    </>
  );
}
function RecoveryCodes({
  codes,
  onClose,
}: {
  codes: string[];
  onClose: () => void;
}) {
  const text = codes.join("\n");
  function download() {
    const url = URL.createObjectURL(
      new Blob([text + "\n"], { type: "text/plain;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "towbar-recovery-codes.txt";
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <Modal.Backdrop
      isOpen={codes.length > 0}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal.Container size="md">
        <Modal.Dialog>
          <Modal.Header>
            <Modal.Heading>Save your recovery codes</Modal.Heading>
            <Modal.CloseTrigger />
          </Modal.Header>
          <Modal.Body>
            <p className="mb-4 text-sm text-muted">
              Each code can be used once to sign in with your password if you
              lose access to your passkeys. These codes won’t be shown again.
            </p>
            <CodeBlock>
              <CodeBlock.Header>
                <CodeBlock.Filename>Recovery codes</CodeBlock.Filename>
                <CodeBlock.CopyButton code={text} />
              </CodeBlock.Header>
              <CodeBlock.Code code={text} />
            </CodeBlock>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onPress={download}>
              Download .txt
            </Button>
            <Button onPress={onClose}>I saved my codes</Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
