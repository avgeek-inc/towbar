"use client";

import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { Children } from "react";
import type { ComponentProps, FormEvent, Key, ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useId, useState } from "react";

import { Alert } from "@workspace/web-design-system/feedback/alert";
import { Spinner } from "@workspace/web-design-system/feedback/spinner";
import { AlertDialog } from "@workspace/web-design-system/overlays/alert-dialog";
import { Button } from "@workspace/web-design-system/buttons/button";
import { Chip } from "@workspace/web-design-system/data-display/chip";
import { Widget } from "@workspace/web-design-system/data-display/widget";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@workspace/web-design-system/forms/field";
import { Input } from "@workspace/web-design-system/forms/input";
import type { InputProps } from "@workspace/web-design-system/forms/input";
import { Tabs } from "@workspace/web-design-system/navigation/tabs";
import { toast } from "@workspace/web-design-system/overlays/toast";
import { PageSection } from "@workspace/web-design-system/layouts/page";
import { cn } from "@workspace/web-design-system/lib/utils";
import { ApplicationPage } from "@workspace/web-page-sections/page";
import type { BreadcrumbAncestors } from "@workspace/web-page-sections/page";

import { refreshApiQueries } from "@/hooks/use-api-query";

const appBreadcrumb = [{ href: "/", label: "Towbar" }] as const;
export const sourcesBreadcrumb = [
  ...appBreadcrumb,
  { href: "/sources", label: "Sources" },
] as BreadcrumbAncestors;
export const serversBreadcrumb = [
  ...appBreadcrumb,
  { href: "/servers", label: "Servers" },
] as BreadcrumbAncestors;

export function DashboardPage({
  actions,
  badge,
  breadcrumbAncestors = appBreadcrumb,
  breadcrumbLabel,
  children,
  icon,
  title,
  titleContent,
}: {
  actions?: ReactNode;
  badge?: ReactNode;
  breadcrumbAncestors?: BreadcrumbAncestors;
  breadcrumbLabel?: string;
  children: ReactNode;
  icon: ComponentProps<typeof HugeiconsIcon>["icon"];
  title: string;
  titleContent?: ReactNode;
}) {
  return (
    <ApplicationPage
      actions={actions}
      badge={badge}
      breadcrumbAncestors={breadcrumbAncestors}
      breadcrumbLabel={breadcrumbLabel}
      title={title}
      titleContent={
        <span className="inline-flex min-w-0 items-center gap-2">
          <HugeiconsIcon
            aria-hidden="true"
            className="size-6 shrink-0"
            icon={icon}
          />
          {titleContent ?? (
            <span className="truncate" title={title}>
              {title}
            </span>
          )}
        </span>
      }
    >
      <PageSection
        className="content-grid pt-0"
        xPadding="none"
        yPadding="compact"
      >
        {Children.toArray(children)}
      </PageSection>
    </ApplicationPage>
  );
}

export function PageTabs({
  defaultValue,
  tabs,
}: {
  defaultValue: string;
  tabs: Array<{
    content: ReactNode;
    icon?: ReactNode;
    indicator?:
      | boolean
      | {
          ariaLabel?: string;
          label?: string;
          dot?: boolean;
          variant?:
            | "default"
            | "secondary"
            | "success"
            | "warning"
            | "destructive"
            | "info";
        };
    label: string;
    value: string;
  }>;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedSection = searchParams.get("section");
  const selectedKey = tabs.some((tab) => tab.value === requestedSection)
    ? requestedSection!
    : defaultValue;

  function selectSection(key: Key) {
    const value = String(key);
    if (value === selectedKey) return;
    const params = new URLSearchParams(searchParams.toString());
    if (value === defaultValue) params.delete("section");
    else params.set("section", value);
    const query = params.toString();
    // Page tabs are client-only state. Native history keeps the permalink and
    // Next navigation hooks in sync without reprocessing the metadata head,
    // which would briefly clear the browser tab title on every selection.
    window.history.pushState(
      null,
      "",
      query ? `${pathname}?${query}` : pathname,
    );
  }

  return (
    <Tabs
      className="grid w-full min-w-0 max-w-full gap-4"
      selectedKey={selectedKey}
      onSelectionChange={selectSection}
    >
      <Tabs.ListContainer className="min-w-0 max-w-full">
        <Tabs.List aria-label="Page sections">
          {tabs.map((tab) => (
            <Tabs.Tab id={tab.value} key={tab.value}>
              <span className="inline-flex min-w-0 items-center gap-2">
                {tab.icon ? (
                  <span
                    aria-hidden="true"
                    className="flex shrink-0 items-center justify-center [&_svg]:size-4"
                  >
                    {tab.icon}
                  </span>
                ) : null}
                <span
                  className="truncate"
                  title={typeof tab.label === "string" ? tab.label : undefined}
                >
                  {tab.label}
                </span>
                {tab.indicator ? (
                  typeof tab.indicator === "object" && tab.indicator.dot ? (
                    <span
                      aria-label={
                        tab.indicator.ariaLabel ??
                        tab.indicator.label ??
                        "Warning"
                      }
                      className="bg-warning size-2 shrink-0 rounded-full"
                      role="img"
                      title={
                        tab.indicator.ariaLabel ??
                        tab.indicator.label ??
                        "Warning"
                      }
                    />
                  ) : (
                    <Chip
                      aria-label={
                        typeof tab.indicator === "object"
                          ? (tab.indicator.ariaLabel ?? tab.indicator.label)
                          : undefined
                      }
                      size="small"
                      variant={
                        typeof tab.indicator === "object"
                          ? tab.indicator.variant
                          : "default"
                      }
                    >
                      {typeof tab.indicator === "object"
                        ? (tab.indicator.label ?? "Active")
                        : "Active"}
                    </Chip>
                  )
                ) : null}
              </span>
              <Tabs.Indicator />
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs.ListContainer>
      {tabs.map((tab) => (
        <Tabs.Panel
          className="m-0 w-full min-w-0 max-w-full p-0 outline-none"
          id={tab.value}
          key={tab.value}
        >
          {tab.content}
        </Tabs.Panel>
      ))}
    </Tabs>
  );
}

export function ActionButton<T>({
  action,
  ariaLabel,
  children,
  confirm,
  isIconOnly = false,
  isDisabled = false,
  onSuccess,
  pendingLabel = "Working…",
  success,
  variant = "secondary",
}: {
  action: () => Promise<T>;
  ariaLabel?: string;
  children: ReactNode;
  confirm?: {
    actionLabel?: string;
    description: string;
    title: ReactNode;
  };
  isIconOnly?: boolean;
  isDisabled?: boolean;
  onSuccess?: (result: T) => void;
  pendingLabel?: string;
  success: string;
  variant?: "danger" | "primary" | "secondary";
}) {
  const [busy, setBusy] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  async function runAction() {
    setBusy(true);
    try {
      const result = await action();
      toast.success(success);
      onSuccess?.(result);
      refreshApiQueries();
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  const triggerContent =
    busy && isIconOnly ? (
      <Spinner aria-label={pendingLabel} size="sm" />
    ) : busy ? (
      pendingLabel
    ) : (
      children
    );
  const trigger = (
    <Button
      aria-label={ariaLabel}
      isDisabled={busy || isDisabled}
      isIconOnly={isIconOnly}
      variant={variant}
      onPress={confirm ? () => setIsConfirming(true) : runAction}
    >
      {triggerContent}
    </Button>
  );
  if (!confirm) {
    return trigger;
  }

  return (
    <>
      {trigger}
      <AlertDialog.Backdrop
        isOpen={isConfirming}
        onOpenChange={setIsConfirming}
      >
        <AlertDialog.Container>
          <AlertDialog.Dialog>
            <AlertDialog.Header>
              <AlertDialog.Heading>{confirm.title}</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>{confirm.description}</AlertDialog.Body>
            <AlertDialog.Footer>
              <Button
                isDisabled={busy || isDisabled}
                variant="secondary"
                onPress={() => setIsConfirming(false)}
              >
                Cancel
              </Button>
              <Button
                isDisabled={busy || isDisabled}
                variant={variant === "danger" ? "danger" : "primary"}
                onPress={() => {
                  setIsConfirming(false);
                  void runAction();
                }}
              >
                {busy ? pendingLabel : (confirm.actionLabel ?? children)}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </>
  );
}

export function FormCard({
  children,
  className,
  headerEnd,
  icon,
  title,
  ...props
}: Omit<ComponentProps<typeof Widget>, "children" | "title"> & {
  children: ReactNode;
  headerEnd?: ReactNode;
  icon?: ReactNode;
  title: string;
}) {
  return (
    <Widget {...props} className={className}>
      <Widget.Header endContent={headerEnd}>
        <Widget.Title icon={icon}>{title}</Widget.Title>
      </Widget.Header>
      <Widget.Content>{children}</Widget.Content>
    </Widget>
  );
}

export function SimpleForm({
  fields,
  onSubmit,
  successMessage = "Saved",
  submitLabel,
}: {
  fields: Array<{
    autoComplete?: string;
    defaultValue?: string;
    description?: string;
    disabled?: boolean;
    label: string;
    maxLength?: number;
    minLength?: number;
    name: string;
    placeholder?: string;
    required?: boolean;
    type?: string;
    variant?: InputProps["variant"];
  }>;
  onSubmit: (values: Record<string, string>) => Promise<void>;
  successMessage?: string;
  submitLabel: string;
}) {
  const formId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    const formData = new FormData(event.currentTarget);
    const values = Object.fromEntries(
      fields
        .filter((field) => !field.disabled)
        .map(({ name }) => {
          const value = formData.get(name);
          return [name, typeof value === "string" ? value : ""];
        }),
    );
    try {
      await onSubmit(values);
      toast.success(successMessage);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="content-grid max-w-xl" onSubmit={submit}>
      {error ? (
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Couldn&apos;t save</Alert.Title>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}
      {fields.map((field) => (
        <Field key={field.name}>
          <FieldLabel htmlFor={`${formId}-${field.name}`}>
            {field.label}
          </FieldLabel>
          <Input
            id={`${formId}-${field.name}`}
            autoComplete={field.autoComplete}
            defaultValue={field.defaultValue}
            disabled={field.disabled}
            maxLength={field.maxLength}
            minLength={field.minLength}
            name={field.name}
            placeholder={field.placeholder}
            required={field.required}
            type={field.type}
            variant={field.variant}
          />
          {field.description ? (
            <FieldDescription>{field.description}</FieldDescription>
          ) : null}
        </Field>
      ))}
      <Button className="w-fit" isDisabled={busy} type="submit">
        {busy ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}

export function InlineLink({
  children,
  className,
  href,
  ...props
}: Omit<ComponentProps<typeof Link>, "children" | "className" | "href"> & {
  children: ReactNode;
  className?: string;
  href: string;
}) {
  return (
    <Link
      {...props}
      className={cn(
        "focus-visible:ring-focus rounded-md underline-offset-4 pointer-fine:hover:underline focus-visible:ring-2",
        className,
      )}
      href={href}
    >
      {children}
    </Link>
  );
}
