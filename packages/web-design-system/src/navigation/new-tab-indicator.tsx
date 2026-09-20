export function NewTabIndicator() {
  return (
    <span className="inline shrink-0 whitespace-nowrap font-normal">
      <span aria-hidden="true">&nbsp;↗</span>
      <span className="sr-only"> (opens in a new tab)</span>
    </span>
  );
}
