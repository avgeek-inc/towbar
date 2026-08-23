"use client";

import { Input } from "@heroui/react";
import type { ComponentProps } from "react";

export type PasswordInputProps = Omit<ComponentProps<typeof Input>, "type">;
export function PasswordInput(props: PasswordInputProps) {
  return <Input type="password" {...props} />;
}
