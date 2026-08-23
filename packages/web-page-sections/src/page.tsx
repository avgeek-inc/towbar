import type { ComponentProps, ReactElement, ReactNode } from "react";
import { Page, PageSection } from "@workspace/web-design-system/layouts/page";
import {
  TypographyHeading,
  TypographyParagraph,
} from "@workspace/web-design-system/typography/typography";
export type BreadcrumbAncestors = readonly [
  { href?: string; label: string },
  ...{ href?: string; label: string }[],
];
type Shared = Omit<ComponentProps<typeof Page>, "lead">;
export interface ApplicationPageProps extends Shared {
  actions?: ReactNode;
  badge?: ReactNode;
  breadcrumbAncestors: BreadcrumbAncestors;
  breadcrumbLabel?: string;
  description?: string;
  title: string;
  titleContent?: ReactNode;
  titleDensity?: string;
}
function TitledPage({
  actions,
  badge,
  breadcrumbAncestors: _breadcrumbAncestors,
  breadcrumbLabel: _breadcrumbLabel,
  children,
  description,
  title,
  titleContent,
  titleDensity: _titleDensity,
  ...props
}: ApplicationPageProps) {
  return (
    <Page
      {...props}
      lead={
        <PageSection yPadding="compact">
          <header className="flex flex-wrap items-center justify-between gap-5">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <TypographyHeading level={1}>
                {titleContent ?? title}
              </TypographyHeading>
              {badge}
            </div>
            {actions}
          </header>
          {description ? (
            <TypographyParagraph className="mt-2" color="muted">
              {description}
            </TypographyParagraph>
          ) : null}
        </PageSection>
      }
    >
      {children}
    </Page>
  );
}
export function ApplicationPage(props: ApplicationPageProps) {
  return <TitledPage {...props} />;
}
export function ContentPage(props: ApplicationPageProps) {
  return <TitledPage {...props} />;
}
export function StatusPage({ children, ...props }: ApplicationPageProps) {
  return <TitledPage {...props}>{children}</TitledPage>;
}
export function AuthPage({
  children,
  ...props
}: Shared & { children: ReactNode }) {
  return (
    <Page {...props}>
      <PageSection
        className="grid min-h-[calc(100dvh-8rem)] place-items-center"
        width="content"
      >
        {children}
      </PageSection>
    </Page>
  );
}
export function MarketingPage({
  children,
  hero,
  ...props
}: Shared & { hero: ReactElement; children: ReactNode }) {
  return (
    <Page
      {...props}
      lead={
        <PageSection width="full" xPadding="none" yPadding="none">
          {hero}
        </PageSection>
      }
    >
      {children}
    </Page>
  );
}
export function HomepageHero({
  actions,
  description,
  eyebrow,
  title,
}: {
  actions?: ReactNode;
  description?: ReactNode;
  eyebrow?: { label: ReactNode };
  title: ReactNode;
}) {
  return (
    <section className="mx-auto grid min-h-[36rem] max-w-7xl content-center gap-6 px-4 py-20 sm:px-6 lg:px-8">
      {eyebrow ? (
        <span className="text-sm font-medium text-muted">{eyebrow.label}</span>
      ) : null}
      <TypographyHeading className="max-w-4xl text-5xl sm:text-6xl" level={1}>
        {title}
      </TypographyHeading>
      {description ? (
        <TypographyParagraph className="max-w-2xl" color="muted" size="lg">
          {description}
        </TypographyParagraph>
      ) : null}
      {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
    </section>
  );
}
