import { Children, isValidElement, type ReactNode } from "react";

export function hasVisibleTextContent(children: ReactNode): boolean {
  return Children.toArray(children).some((child) => {
    if (typeof child === "string" || typeof child === "number") {
      return String(child).trim().length > 0;
    }
    return isValidElement<{ children?: ReactNode }>(child)
      ? hasVisibleTextContent(child.props.children)
      : false;
  });
}
