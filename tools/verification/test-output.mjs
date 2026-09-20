export function requiredTestCounts(output) {
  const read = (label) => {
    const matches = [
      ...output.matchAll(new RegExp(`^# ${label} (\\d+)\\s*$`, "gm")),
    ];
    if (matches.length !== 1)
      throw new Error(
        `Required suite must report exactly one TAP ${label} count`,
      );
    return Number(matches[0][1]);
  };
  const counts = Object.fromEntries(
    ["tests", "pass", "fail", "cancelled", "skipped", "todo"].map((label) => [
      label,
      read(label),
    ]),
  );
  if (counts.tests === 0 || counts.pass === 0)
    throw new Error("Required suite did not execute any passing tests");
  for (const label of ["fail", "cancelled", "skipped", "todo"]) {
    if (counts[label] !== 0)
      throw new Error(
        `Required suite reported ${counts[label]} ${label} tests`,
      );
  }
  if (counts.pass !== counts.tests)
    throw new Error("Required suite did not complete every test");
  return counts;
}
