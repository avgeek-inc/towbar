import type { ComponentPropsWithoutRef, ElementType } from "react";

export type ComponentRootProps<
  TElement extends ElementType,
  TOwnProps extends object = object,
> = Omit<ComponentPropsWithoutRef<TElement>, keyof TOwnProps> & TOwnProps;
