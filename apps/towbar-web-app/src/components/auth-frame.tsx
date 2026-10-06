import Link from "next/link";
import type { ReactNode } from "react";
import { AuthScreen } from "@avgeek-oss/design-system";
import { TowbarLockup } from "@workspace/towbar-web-ui/brand";

export const authTextActionClassName =
  "w-fit text-sm/5 text-muted underline decoration-dashed underline-offset-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-focus";
export function AuthBrand() {
  return (
    <Link aria-label="Towbar sign in" className="w-fit" href="/login">
      <TowbarLockup />
    </Link>
  );
}
export function AuthFrame({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <AuthScreen brand={<AuthBrand />} title={title} description={description}>
      {children}
    </AuthScreen>
  );
}
