"use client";
import { FieldDescription } from "@workspace/web-design-system/forms/field";
import { useEffect, useRef, useState } from "react";
import { Modal } from "@workspace/web-design-system/overlays/modal";
import { AuthForm } from "./auth-form";
import { api } from "@/lib/api";
import { useAccess } from "./access-context";
export function ReauthenticationDialog() {
  const { user } = useAccess();
  const [open, setOpen] = useState(false);
  const pending = useRef<Array<(result: boolean) => void>>([]);
  function finish(result: boolean) {
    pending.current.splice(0).forEach((resolve) => resolve(result));
    setOpen(false);
  }
  useEffect(() => {
    const queue = pending.current;
    const handle = (event: Event) => {
      const request = event as CustomEvent<{
        resolve: (result: boolean) => void;
      }>;
      queue.push(request.detail.resolve);
      setOpen(true);
    };
    window.addEventListener("towbar:reauthenticate", handle);
    return () => {
      window.removeEventListener("towbar:reauthenticate", handle);
      queue.splice(0).forEach((resolve) => resolve(false));
    };
  }, []);
  return (
    <Modal.Backdrop
      isOpen={open}
      onOpenChange={(value) => {
        if (!value) finish(false);
      }}
    >
      <Modal.Container size="sm">
        <Modal.Dialog>
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>Confirm it’s you</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            <FieldDescription className="mb-4">
              Confirm your password to continue with this sensitive action.
            </FieldDescription>
            <AuthForm
              variant="secondary"
              errorPresentation="toast"
              fields={[
                {
                  name: "password",
                  label: "Password",
                  type: "password",
                  autoComplete: "current-password",
                  required: true,
                  maxLength: 1024,
                },
                ...(user?.twoFactorEnabled
                  ? [
                      {
                        name: "code",
                        label: "Authenticator code",
                        autoComplete: "one-time-code",
                        required: true,
                        maxLength: 6,
                      },
                    ]
                  : []),
              ]}
              submitLabel="Confirm"
              onSubmit={async (values) => {
                await api.post("/v1/core/session/reauthenticate", values);
                finish(true);
              }}
            />
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
