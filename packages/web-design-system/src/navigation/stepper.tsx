"use client";

import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  type ComponentProps,
  type ReactElement,
  useContext,
} from "react";
import { cn } from "../lib/utils";
const Context = createContext({
  currentStep: 0,
  orientation: "horizontal" as "horizontal" | "vertical",
});
const StepContext = createContext({ index: 0 });
type RootProps = ComponentProps<"ol"> & {
  currentStep?: number;
  orientation?: "horizontal" | "vertical";
  size?: string;
};
function Root({
  children,
  className,
  currentStep = 0,
  orientation = "horizontal",
  ...props
}: RootProps) {
  return (
    <Context.Provider value={{ currentStep, orientation }}>
      <ol
        className={cn(
          orientation === "horizontal" ? "flex items-start" : "grid",
          className,
        )}
        {...props}
      >
        {Children.map(children, (child, index) =>
          isValidElement(child)
            ? cloneElement(child as ReactElement<{ stepIndex?: number }>, {
                stepIndex: index,
              })
            : child,
        )}
      </ol>
    </Context.Provider>
  );
}
function Step({
  className,
  stepIndex = 0,
  ...props
}: ComponentProps<"li"> & { stepIndex?: number }) {
  const { orientation } = useContext(Context);
  return (
    <StepContext.Provider value={{ index: stepIndex }}>
      <li
        className={cn(
          "relative",
          orientation === "horizontal"
            ? "flex min-w-0 flex-1 items-start"
            : "grid grid-cols-[auto_1fr] gap-x-3",
          className,
        )}
        {...props}
      />
    </StepContext.Provider>
  );
}
function Indicator({ className, ...props }: ComponentProps<"span">) {
  const { currentStep } = useContext(Context);
  const { index } = useContext(StepContext);
  return (
    <span
      aria-current={index === currentStep ? "step" : undefined}
      className={cn(
        "relative z-10 grid size-7 shrink-0 place-items-center rounded-full border text-xs font-semibold",
        index <= currentStep
          ? "border-accent bg-accent text-accent-foreground"
          : "border-separator bg-surface text-muted",
        className,
      )}
      {...props}
    >
      {index < currentStep ? "✓" : index + 1}
    </span>
  );
}
function Content({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("grid min-w-0 gap-0.5 px-3 pb-6", className)}
      {...props}
    />
  );
}
function Title({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("text-sm font-medium", className)} {...props} />;
}
function Description({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("text-sm text-muted", className)} {...props} />;
}
function Separator({ className, ...props }: ComponentProps<"span">) {
  const { orientation } = useContext(Context);
  return (
    <span
      aria-hidden
      className={cn(
        orientation === "horizontal"
          ? "mt-3.5 h-px min-w-6 flex-1 bg-separator"
          : "absolute bottom-0 left-3.5 top-7 w-px bg-separator",
        className,
      )}
      {...props}
    />
  );
}
export const Stepper = Object.assign(Root, {
  Content,
  Description,
  Indicator,
  Root,
  Separator,
  Step,
  Title,
});
