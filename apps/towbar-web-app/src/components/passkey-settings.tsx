"use client";
import { FieldDescription } from "@workspace/web-design-system/forms/field";
import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Key01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@workspace/web-design-system/buttons/button";
import { Modal } from "@workspace/web-design-system/overlays/modal";
import { Chip } from "@workspace/web-design-system/data-display/chip";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { FormCard, ActionButton } from "./page-parts";
import { AuthForm } from "./auth-form";
import { useAccess } from "./access-context";
import { RelativeTime } from "./last-synced-time";
import { useApiQuery } from "@/hooks/use-api-query";
import { api } from "@/lib/api";
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
  function edit(key: Passkey | null) {
    setEditing(key);
    setInstance((v) => v + 1);
    setOpen(true);
  }
  return (
    <>
      <FormCard
        title="Passkeys"
        icon={<HugeiconsIcon icon={Key01Icon} />}
        headerEnd={
          keys.data && !keys.error ? (
            <Chip variant="secondary">
              {keys.data.passkeys.length
                ? `${keys.data.passkeys.length} added`
                : "None added"}
            </Chip>
          ) : undefined
        }
      >
        <div className="content-grid">
          <FieldDescription>
            Verify your sign-in after entering your password with your
            fingerprint, face, or device PIN. Passkeys can be stored on your
            device or in your password manager.
          </FieldDescription>
          {keys.error ? (
            <QueryError message={keys.error} />
          ) : !keys.data ? (
            <QueryLoading />
          ) : keys.data.passkeys.length ? (
            <ul className="divide-y divide-separator">
              {keys.data.passkeys.map((key) => (
                <li
                  key={key.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0"
                >
                  <div className="min-w-0">
                    <p className="font-medium break-words">
                      {key.name || "Passkey"}
                    </p>
                    <div className="text-sm text-muted">
                      <RelativeTime value={key.createdAt} label="Added" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="secondary" onPress={() => edit(key)}>
                      Rename
                    </Button>
                    <ActionButton
                      variant="danger"
                      success="Passkey removed"
                      confirm={{
                        title: "Remove passkey?",
                        description: `${key.name || "This passkey"} will no longer be available for two-factor authentication.`,
                        actionLabel: "Remove",
                      }}
                      action={async () => {
                        await api.post(
                          "/v1/public/auth/identity/passkey/delete-passkey",
                          { id: key.id },
                        );
                        keys.refresh();
                      }}
                    >
                      Remove
                    </ActionButton>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          <div>
            <Button onPress={() => edit(null)}>Add passkey</Button>
          </div>
        </div>
      </FormCard>
      <Modal.Backdrop isOpen={open} onOpenChange={setOpen}>
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>
                {editing ? "Rename passkey" : "Add passkey"}
              </Modal.Heading>
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
                      await registerPasskey(values.name ?? "", user.email);
                    }
                  } catch (error) {
                    throw new Error(passkeyError(error));
                  }
                  setOpen(false);
                  keys.refresh();
                }}
              >
                {!editing ? (
                  <FieldDescription>
                    Your browser will ask where to save your passkey and verify
                    your identity.
                  </FieldDescription>
                ) : null}
              </AuthForm>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </>
  );
}
