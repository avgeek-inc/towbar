"use client";
import { useId, useState, type ReactNode, type FormEvent } from "react";
import { Button } from "@workspace/web-design-system/buttons/button";
import {
  Field,
  FieldDescription,
} from "@workspace/web-design-system/forms/field";
import { Label } from "@workspace/web-design-system/forms/label";
import { Input } from "@workspace/web-design-system/forms/input";
import { PasswordInput } from "@workspace/web-design-system/forms/password-input";
import { Alert } from "@workspace/web-design-system/feedback/alert";
import { toast } from "@workspace/web-design-system/overlays/toast";
export function AuthForm({
  fields,
  onSubmit,
  submitLabel,
  submitClassName = "w-fit",
  busyLabel = "Please wait…",
  variant = "primary",
  onCancel,
  cancelLabel = "Cancel",
  errorPresentation = "inline",
  children,
}: {
  fields: Array<{
    name: string;
    label: string;
    labelAction?: ReactNode;
    type?: string;
    autoComplete?: string;
    required?: boolean;
    minLength?: number;
    maxLength?: number;
    description?: string;
    defaultValue?: string;
    disabled?: boolean;
    inputMode?: "text" | "numeric";
    autoFocus?: boolean;
  }>;
  variant?: "primary" | "secondary";
  onCancel?: () => void;
  cancelLabel?: string;
  errorPresentation?: "inline" | "toast";
  onSubmit: (values: Record<string, string>) => Promise<void>;
  submitLabel: string;
  submitClassName?: string;
  busyLabel?: string;
  children?: ReactNode;
}) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError(undefined);
    try {
      await onSubmit(
        Object.fromEntries(
          fields
            .filter((field) => !field.disabled)
            .map((field) => [field.name, String(data.get(field.name) ?? "")]),
        ),
      );
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : "Unable to continue. Try again.";
      if (errorPresentation === "toast") toast.danger(message);
      else setError(message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="content-grid" onSubmit={submit} aria-busy={busy}>
      {error ? (
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}
      {fields.map(({ label, labelAction, description, type, ...field }) => (
        <Field key={field.name}>
          {labelAction ? (
            <div className="flex items-center justify-between gap-3">
              <Label
                htmlFor={`${id}-${field.name}`}
                isRequired={field.required}
              >
                {label}
              </Label>
              {labelAction}
            </div>
          ) : (
            <Label htmlFor={`${id}-${field.name}`} isRequired={field.required}>
              {label}
            </Label>
          )}
          {type === "password" ? (
            <PasswordInput
              {...field}
              variant={variant}
              id={`${id}-${field.name}`}
            />
          ) : (
            <Input
              {...field}
              variant={variant}
              type={type}
              id={`${id}-${field.name}`}
            />
          )}{" "}
          {description ? (
            <FieldDescription>{description}</FieldDescription>
          ) : null}
        </Field>
      ))}
      {children}
      <div className={onCancel ? "flex flex-wrap justify-end gap-3" : "flex"}>
        {onCancel ? (
          <Button variant="secondary" isDisabled={busy} onPress={onCancel}>
            {cancelLabel}
          </Button>
        ) : null}
        <Button type="submit" isDisabled={busy} className={submitClassName}>
          {busy ? busyLabel : submitLabel}
        </Button>
      </div>
    </form>
  );
}
