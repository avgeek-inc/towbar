"use client";

import { Avatar as HeroAvatar } from "@heroui/react";
import { useEffect, useState, type ComponentProps } from "react";
import { cn } from "../lib/utils";

export type AvatarProps = Omit<
  ComponentProps<typeof HeroAvatar>,
  "children"
> & {
  email: string;
  name?: string;
  src?: string;
};

export function Avatar({ email, name, src, className, ...props }: AvatarProps) {
  const normalizedEmail = email.trim().toLowerCase();
  const [image, setImage] = useState<{ email: string; url: string } | null>(
    null,
  );
  const words = (name?.trim() || normalizedEmail.split("@")[0] || "?")
    .split(/[\s._-]+/u)
    .filter(Boolean);
  const initials = [words[0]?.[0], words.length > 1 ? words.at(-1)?.[0] : ""]
    .join("")
    .toUpperCase();

  useEffect(() => {
    if (!normalizedEmail || !globalThis.crypto?.subtle) return;
    let active = true;
    void crypto.subtle
      .digest("SHA-256", new TextEncoder().encode(normalizedEmail))
      .then((digest) => {
        const hash = Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("");
        if (active) {
          setImage({
            email: normalizedEmail,
            url: `https://www.gravatar.com/avatar/${hash}?s=160&d=404&r=g`,
          });
        }
      })
      .catch(() => {
        if (active) setImage(null);
      });
    return () => {
      active = false;
    };
  }, [normalizedEmail]);

  return (
    <HeroAvatar
      aria-label={name?.trim() || normalizedEmail || "User"}
      className={cn("rounded-lg", className)}
      role="img"
      {...props}
    >
      <HeroAvatar.Image
        key={normalizedEmail}
        alt=""
        className="object-cover"
        referrerPolicy="no-referrer"
        src={src ?? (image?.email === normalizedEmail ? image.url : undefined)}
      />
      <HeroAvatar.Fallback aria-hidden="true">{initials}</HeroAvatar.Fallback>
    </HeroAvatar>
  );
}
