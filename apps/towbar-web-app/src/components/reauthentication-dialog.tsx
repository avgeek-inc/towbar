"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@workspace/web-design-system/buttons/button";
import { Field, FieldError } from "@workspace/web-design-system/forms/field";
import { Label } from "@workspace/web-design-system/forms/label";
import { PasswordInput } from "@workspace/web-design-system/forms/password-input";
import { Modal } from "@workspace/web-design-system/overlays/modal";
import { toast } from "@workspace/web-design-system/overlays/toast";
import { api } from "@/lib/api";
import { PasskeyChallenge } from "./second-factor-challenge";
import { useAccess } from "./access-context";

export function ReauthenticationDialog() {
  const { user } = useAccess();
  const [open, setOpen] = useState(false);
  const pending = useRef<Array<(result: boolean) => void>>([]);
  const finish = useCallback((result: boolean) => {
    pending.current.splice(0).forEach((resolve) => resolve(result));
    setOpen(false);
  }, []);
  const confirmed = useCallback(() => finish(true), [finish]);
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
          <Modal.Header>
            <Modal.Heading>Confirm it’s you</Modal.Heading>
            <Modal.CloseTrigger />
          </Modal.Header>
          <Modal.Body>
            {open ? (
              user?.twoFactorEnabled ? (
                <PasskeyChallenge onVerified={confirmed} />
              ) : (
                <ReauthenticationFields
                  email={user?.email ?? ""}
                  onConfirmed={confirmed}
                />
              )
            ) : null}
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

function ReauthenticationFields({
  email,
  onConfirmed,
}: {
  email: string;
  onConfirmed: () => void;
}) {
  const passwordId = useId();
  const passwordRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState<"password" | null>(null);

  async function confirm() {
    if (busy) return;
    const password = passwordRef.current?.value ?? "";
    if (!password) {
      setInvalid("password");
      passwordRef.current?.focus();
      return;
    }
    setInvalid(null);
    setBusy(true);
    try {
      await api.post("/v1/core/session/reauthenticate", {
        password,
      });
      onConfirmed();
    } catch (error) {
      toast.danger(
        error instanceof Error
          ? error.message
          : "Unable to continue. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="form"
      aria-label="Confirm identity"
      aria-busy={busy}
      className="content-grid"
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
          event.preventDefault();
          void confirm();
        }
      }}
    >
      <input
        aria-hidden="true"
        autoComplete="username"
        className="sr-only"
        defaultValue={email}
        name="username"
        tabIndex={-1}
        type="text"
      />
      <Field>
        <Label htmlFor={passwordId} isRequired>
          Password
        </Label>
        <PasswordInput
          id={passwordId}
          ref={passwordRef}
          name="password"
          variant="secondary"
          autoComplete="current-password"
          maxLength={1024}
          aria-invalid={invalid === "password"}
          onChange={() => setInvalid(null)}
          disabled={busy}
        />
        {invalid === "password" ? (
          <FieldError>Enter your password.</FieldError>
        ) : null}
      </Field>
      <div className="flex">
        <Button isDisabled={busy} onPress={() => void confirm()}>
          {busy ? "Please wait…" : "Confirm"}
        </Button>
      </div>
    </div>
  );
}
