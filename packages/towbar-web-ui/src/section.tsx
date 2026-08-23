import type { ReactNode } from "react";

import {
  TypographyHeading,
  TypographyParagraph,
} from "@workspace/web-design-system/typography/typography";

export function TowbarSection({
  actions,
  children,
  description,
  headingLevel = 2,
  title,
}: {
  actions?: ReactNode;
  children: ReactNode;
  description?: string;
  headingLevel?: 2 | 3 | 4 | 5 | 6;
  title: string;
}) {
  return (
    <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5">
      <div className="flex max-w-4xl flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 max-w-3xl">
          <SectionHeading level={headingLevel}>{title}</SectionHeading>
          {description ? (
            <TypographyParagraph className="mt-1" color="muted" size="sm">
              {description}
            </TypographyParagraph>
          ) : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

function SectionHeading({
  children,
  level,
}: {
  children: ReactNode;
  level: 2 | 3 | 4 | 5 | 6;
}) {
  switch (level) {
    case 3:
      return <TypographyHeading level={3}>{children}</TypographyHeading>;
    case 4:
      return <TypographyHeading level={4}>{children}</TypographyHeading>;
    case 5:
      return <TypographyHeading level={5}>{children}</TypographyHeading>;
    case 6:
      return <TypographyHeading level={6}>{children}</TypographyHeading>;
    default:
      return <TypographyHeading level={2}>{children}</TypographyHeading>;
  }
}
