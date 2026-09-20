import { type SQLWrapper, and, eq, lt, or, sql } from "drizzle-orm";
import { z } from "zod";

export const historyQueryShape = {
  limit: z.coerce.number().int().min(1).max(100).default(25),
  before: z.iso.datetime({ offset: true }).optional(),
  beforeId: z.uuid().optional(),
  search: z.string().trim().max(200).default(""),
};
export function pairedCursor(input: { before?: string; beforeId?: string }) {
  return Boolean(input.before) === Boolean(input.beforeId);
}
export function historyCursor(
  createdAt: SQLWrapper,
  id: SQLWrapper,
  input: { before?: string; beforeId?: string },
) {
  if (!input.before || !input.beforeId) return undefined;
  // Keep PostgreSQL's microseconds intact rather than round-trip through JS Date.
  const timestamp = sql`${input.before}::timestamptz`;
  return or(
    lt(createdAt, timestamp),
    and(eq(createdAt, timestamp), lt(id, input.beforeId)),
  );
}
export function cursorTimestamp(column: SQLWrapper) {
  return sql<string>`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}
export function searchPattern(value: string) {
  return `%${value.replace(/[\\%_]/g, "\\$&")}%`;
}
export function historyPage<T extends { id: string; cursorTime: string }>(
  rows: T[],
  limit: number,
) {
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map(({ cursorTime: _, ...item }) => item),
    nextCursor:
      rows.length > limit && last
        ? { before: last.cursorTime, beforeId: last.id }
        : null,
  };
}
