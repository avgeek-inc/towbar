import type { AnalyticsFilter } from "@workspace/towbar-web-client";

export function analyticsRowFilterMatches(
  filter: AnalyticsFilter,
  field: AnalyticsFilter["field"],
  value: string,
) {
  if (filter.field !== field) return false;
  if (filter.operator === "in")
    return Array.isArray(filter.value) && filter.value.includes(value);
  if (typeof filter.value !== "string") return false;
  return filter.operator === "equals"
    ? filter.value === value
    : value.startsWith(filter.value);
}

export function toggleAnalyticsRowFilter(
  filters: AnalyticsFilter[],
  field: AnalyticsFilter["field"],
  value: string,
): AnalyticsFilter[] {
  if (filters.some((filter) => analyticsRowFilterMatches(filter, field, value)))
    return filters.flatMap((filter) => {
      if (!analyticsRowFilterMatches(filter, field, value)) return [filter];
      if (filter.operator !== "in" || !Array.isArray(filter.value)) return [];
      const remaining = filter.value.filter((item) => item !== value);
      return remaining.length ? [{ ...filter, value: remaining }] : [];
    });
  if (field !== "path") {
    const existing = filters.find(
      (filter) => filter.field === field && filter.operator === "in",
    );
    if (existing?.operator === "in" && Array.isArray(existing.value)) {
      if (existing.value.length >= 20) return filters;
      return filters.map((filter) =>
        filter === existing
          ? { ...existing, value: [...existing.value, value] }
          : filter,
      );
    }
  }
  if (filters.length >= 8) return filters;
  return field === "path"
    ? [...filters, { field, operator: "equals", value }]
    : [...filters, { field, operator: "in", value: [value] }];
}
