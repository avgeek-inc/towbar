"use client";

import { useEffect, useId, useState } from "react";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@workspace/web-design-system/buttons/button";
import {
  Field,
  FieldError,
  FieldGroup,
} from "@workspace/web-design-system/forms/field";
import { Input } from "@workspace/web-design-system/forms/input";
import { PasswordInput } from "@workspace/web-design-system/forms/password-input";
import { Label } from "@workspace/web-design-system/forms/label";
import { Alert } from "@workspace/web-design-system/feedback/alert";
import type { ComponentRootProps } from "@workspace/web-design-system/lib/component-root-props";
import { cn } from "@workspace/web-design-system/lib/utils";

import type { ReactNode } from "react";

const credentialsSchema = z.object({
  identifier: z.string().trim().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

export type IdentityCredentials = z.infer<typeof credentialsSchema>;

type IdentityCredentialsFormOwnProps = {
  children?: never;
  defaultIdentifier?: string;
  disabled?: boolean;
  identifier?: string;
  identifierAutoComplete?: string;
  identifierLabel?: string;
  identifierPlaceholder?: string;
  identifierType?: "email" | "text";
  onIdentifierChange?: (identifier: string) => void;
  onSubmit: (credentials: IdentityCredentials) => Promise<void>;
  passwordAction?: ReactNode;
  submitLabel?: string;
  submittingLabel?: string;
};

type IdentityCredentialsFormProps = Omit<
  ComponentRootProps<"form", IdentityCredentialsFormOwnProps>,
  "method"
>;

export function IdentityCredentialsForm({
  className,
  defaultIdentifier = "",
  disabled = false,
  identifier,
  identifierAutoComplete = "username",
  identifierLabel = "Username",
  identifierPlaceholder,
  identifierType = "text",
  onIdentifierChange,
  onSubmit,
  passwordAction,
  submitLabel = "Sign in",
  submittingLabel = "Signing in…",
  ...props
}: IdentityCredentialsFormProps) {
  const identifierId = useId();
  const passwordId = useId();
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    setError,
    setValue,
    watch,
  } = useForm<IdentityCredentials>({
    defaultValues: {
      identifier: identifier ?? defaultIdentifier,
      password: "",
    },
    mode: "onTouched",
    resolver: standardSchemaResolver(credentialsSchema),
  });
  const currentIdentifier = watch("identifier");
  const identifierField = register("identifier");

  useEffect(() => {
    if (identifier === undefined || identifier === currentIdentifier) return;
    setValue("identifier", identifier);
  }, [currentIdentifier, identifier, setValue]);

  const submit = handleSubmit(async (credentials) => {
    setSubmissionError(null);
    if (
      identifierType === "email" &&
      !z.email().safeParse(credentials.identifier).success
    ) {
      setError("identifier", { message: "Enter a valid email address" });
      return;
    }
    try {
      await onSubmit(credentials);
    } catch (error) {
      setSubmissionError(
        error instanceof Error ? error.message : "Sign in failed",
      );
    }
  });

  return (
    <form
      className={cn("grid gap-5", className)}
      {...props}
      method="post"
      onSubmit={submit}
    >
      <FieldGroup>
        <Field>
          <Label htmlFor={identifierId}>{identifierLabel}</Label>
          <Input
            id={identifierId}
            type={identifierType}
            autoComplete={identifierAutoComplete}
            aria-invalid={Boolean(errors.identifier)}
            placeholder={identifierPlaceholder}
            {...identifierField}
            onChange={(event) => {
              identifierField.onChange(event);
              onIdentifierChange?.(event.target.value);
            }}
          />
          {errors.identifier && (
            <FieldError>{errors.identifier.message}</FieldError>
          )}
        </Field>
        <Field>
          <div className="flex items-center justify-between">
            <Label htmlFor={passwordId}>Password</Label>
            {passwordAction}
          </div>
          <PasswordInput
            id={passwordId}
            autoComplete="current-password"
            aria-invalid={Boolean(errors.password)}
            {...register("password")}
          />
          {errors.password && (
            <FieldError>{errors.password.message}</FieldError>
          )}
        </Field>
      </FieldGroup>
      {submissionError && (
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>{submissionError}</Alert.Description>
          </Alert.Content>
        </Alert>
      )}
      <Button
        type="submit"
        isDisabled={disabled || isSubmitting}
        className="w-full"
      >
        {isSubmitting ? submittingLabel : submitLabel}
      </Button>
    </form>
  );
}
