import type { ReactNode } from "react";
import Link from "next/link";

import {
  IdentityAuthFrame,
  IdentityAuthHeading,
} from "@workspace/identity-web-ui/identity-auth-frame";
import { TowbarLockup } from "@workspace/towbar-web-ui/brand";

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
    <IdentityAuthFrame>
      <div className="grid gap-8">
        <Link aria-label="Towbar home" className="w-fit" href="/">
          <TowbarLockup />
        </Link>
        <IdentityAuthHeading title={title} titleElementType="h1">
          {description}
        </IdentityAuthHeading>
        {children}
      </div>
    </IdentityAuthFrame>
  );
}
