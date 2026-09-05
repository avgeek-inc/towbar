import Link from "next/link";

import {
  IdentityAuthFrame,
  IdentityAuthHeading,
} from "@workspace/identity-web-ui/identity-auth-frame";
import { TowbarLockup } from "@workspace/towbar-web-ui/brand";

import type { ReactNode } from "react";

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
      <div className="content-grid">
        <Link aria-label="Towbar sign in" className="w-fit" href="/login">
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
