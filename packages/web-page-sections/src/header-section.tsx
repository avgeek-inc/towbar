import type { ComponentProps, ReactNode } from "react";
import {
  TypographyHeading,
  TypographyParagraph,
} from "@workspace/web-design-system/typography/typography";
import { cn } from "@workspace/web-design-system/lib/utils";
export function HeaderSection({
  action,
  className,
  description,
  label,
  title,
  ...props
}: ComponentProps<"div"> & {
  action?: ReactNode;
  description?: ReactNode;
  label?: ReactNode;
  title: ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid gap-4 md:grid-cols-[1fr_auto] md:items-start",
        className,
      )}
      {...props}
    >
      <div className="grid max-w-2xl gap-1.5">
        {label ? (
          <TypographyParagraph color="muted" size="sm" weight="medium">
            {label}
          </TypographyParagraph>
        ) : null}
        <TypographyHeading level={3}>{title}</TypographyHeading>
        {description ? (
          <TypographyParagraph color="muted">{description}</TypographyParagraph>
        ) : null}
      </div>
      {action}
    </div>
  );
}
