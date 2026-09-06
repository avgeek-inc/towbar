type Point = { x: number; y: number };

/** Join only bounded gaps within one series, without inventing measurements. */
export function monitoringChartGaps(
  rows: Record<string, number | null | undefined>[],
  key: string,
): [Point, Point][] {
  const gaps: [Point, Point][] = [];
  let previous: { index: number; point: Point } | undefined;
  rows.forEach((row, index) => {
    const value = row[key];
    if (typeof value !== "number" || !Number.isFinite(value)) return;
    const point = { x: row.at!, y: value };
    if (previous && index > previous.index + 1) {
      gaps.push([previous.point, point]);
    }
    previous = { index, point };
  });
  return gaps;
}
