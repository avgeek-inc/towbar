"use client";

import Link from "next/link";
import { Children } from "react";
import type { ComponentProps, FormEvent, Key, ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Alert } from "@workspace/web-design-system/feedback/alert";
import { Spinner } from "@workspace/web-design-system/feedback/spinner";
import { AlertDialog } from "@workspace/web-design-system/overlays/alert-dialog";
import { Button } from "@workspace/web-design-system/buttons/button";
import { Card } from "@workspace/web-design-system/layout/card";
import { Chip } from "@workspace/web-design-system/data-display/chip";
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
import { TowbarSection } from "@workspace/towbar-web-ui/section";

import { refreshApiQueries } from "@/hooks/use-api-query";

export const appBreadcrumb = [{ href: "/", label: "Towbar" }] as const;
export const sourcesBreadcrumb = [
  ...appBreadcrumb,
  { href: "/sources", label: "Sources" },
] as BreadcrumbAncestors;

export function DashboardPage({
  actions,
  badge,
  breadcrumbAncestors = appBreadcrumb,
  breadcrumbLabel,
  children,
  title,
  titleContent,
}: {
  actions?: ReactNode;
  badge?: ReactNode;
  breadcrumbAncestors?: BreadcrumbAncestors;
  breadcrumbLabel?: string;
  children: ReactNode;
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
      titleContent={titleContent}
    >
      {Children.toArray(children).map((child, index) => (
        <PageSection key={`dashboard-section-${index}`} yPadding="compact">
          {child}
        </PageSection>
      ))}
    </ApplicationPage>
  );
}

export function SectionBlock({
  children,
  description,
  headingLevel,
  title,
}: {
  children: ReactNode;
  description?: string;
  headingLevel?: 2 | 3 | 4 | 5 | 6;
  title: string;
}) {
  return (
    <TowbarSection
      description={description}
      headingLevel={headingLevel}
      title={title}
    >
      {children}
    </TowbarSection>
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
          label?: string;
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
  const router = useRouter();
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
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
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
                  <Chip
                    aria-label={
                      typeof tab.indicator === "object"
                        ? tab.indicator.label
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
                ) : null}
              </span>
              <Tabs.Indicator />
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs.ListContainer>
      {tabs.map((tab) => (
        <Tabs.Panel
          className="w-full min-w-0 max-w-full outline-none"
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
  onSuccess?: (result: T) => void;
  pendingLabel?: string;
  success: string;
  variant?: "danger" | "primary" | "secondary";
}) {
  const [busy, setBusy] = useState(false);
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
      isDisabled={busy}
      isIconOnly={isIconOnly}
      variant={variant}
      onPress={confirm ? undefined : runAction}
    >
      {triggerContent}
    </Button>
  );
  if (!confirm) {
    return trigger;
  }

  return (
    <AlertDialog>
      {trigger}
      <AlertDialog.Backdrop>
        <AlertDialog.Container>
          <AlertDialog.Dialog>
            <AlertDialog.Header>
              <AlertDialog.Heading>{confirm.title}</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>{confirm.description}</AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot="close" variant="secondary" isDisabled={busy}>
                Cancel
              </Button>
              <Button
                slot="close"
                isDisabled={busy}
                variant={variant === "danger" ? "danger" : "primary"}
                onPress={runAction}
              >
                {busy ? pendingLabel : (confirm.actionLabel ?? children)}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </AlertDialog>
  );
}

export function FormCard({
  children,
  className,
  description,
  title,
  ...props
}: Omit<ComponentProps<typeof Card>, "children" | "title"> & {
  children: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <Card {...props} className={className}>
      <Card.Header>
        <Card.Title>{title}</Card.Title>
        <Card.Description>{description}</Card.Description>
      </Card.Header>
      <Card.Content>{children}</Card.Content>
    </Card>
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    const values = Object.fromEntries(
      new FormData(event.currentTarget).entries(),
    ) as Record<string, string>;
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
    <form className="grid max-w-xl gap-5" onSubmit={submit}>
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
          <FieldLabel>{field.label}</FieldLabel>
          <Input
            autoComplete={field.autoComplete}
            defaultValue={field.defaultValue}
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
