"use client";

type DeploymentChoice = "all" | "failures" | null;

export function DeploymentNotificationChoice({
  disabled,
  label,
  name,
  onChange,
  value,
}: {
  disabled: boolean;
  label: string;
  name: string;
  onChange: (value: DeploymentChoice) => void;
  value: DeploymentChoice;
}) {
  return (
    <fieldset
      disabled={disabled}
      className="flex items-center gap-3 whitespace-nowrap"
    >
      <legend className="sr-only">Deployments for {label}</legend>
      {(
        [
          ["all", "All"],
          ["failures", "Failures only"],
        ] as const
      ).map(([option, text]) => (
        <label
          key={option}
          className="inline-flex cursor-pointer items-center gap-1.5"
        >
          <input
            type="radio"
            name={name}
            value={option}
            checked={value === option}
            onChange={() => onChange(option)}
            className="size-4 accent-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          />
          <span>{text}</span>
        </label>
      ))}
      {value ? (
        <button
          type="button"
          className="text-muted underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          onClick={() => onChange(null)}
        >
          Clear
        </button>
      ) : null}
    </fieldset>
  );
}
