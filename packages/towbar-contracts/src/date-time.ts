import { z } from "zod";

export const dateFormatOptions = [
  { id: "day-short-month-year", label: "16 Sept 2026" },
  { id: "short-month-day-year", label: "Sept 16, 2026" },
  { id: "year-month-day", label: "2026-09-16" },
  { id: "day-month-year", label: "16/09/2026" },
  { id: "month-day-year", label: "09/16/2026" },
] as const;
export const timeFormatOptions = [
  { id: "24-hour", label: "14:30" },
  { id: "12-hour", label: "2:30 PM" },
  { id: "24-hour-seconds", label: "14:30:45" },
  { id: "12-hour-seconds", label: "2:30:45 PM" },
] as const;
export const defaultDateTimePreferences = {
  dateFormat: "day-short-month-year",
  timeFormat: "24-hour",
  timeZone: "UTC",
} as const;

export function isTimeZone(value: string) {
  if (!value || value.length > 100 || /^[+-]/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function availableTimeZones() {
  // ICU versions may list older IANA names while accepting the current names.
  return [
    ...new Set(
      [
        "UTC",
        ...Intl.supportedValuesOf("timeZone"),
        "Asia/Kolkata",
        "Asia/Kathmandu",
        "Asia/Yangon",
        "Europe/Kyiv",
        "America/Nuuk",
        "Pacific/Kanton",
      ].filter(isTimeZone),
    ),
  ].sort((left, right) =>
    left === "UTC" ? -1 : right === "UTC" ? 1 : left.localeCompare(right),
  );
}

export const dateTimePreferencesSchema = z
  .object({
    dateFormat: z.enum(dateFormatOptions.map((option) => option.id)),
    timeFormat: z.enum(timeFormatOptions.map((option) => option.id)),
    timeZone: z
      .string()
      .min(1)
      .max(100)
      .refine(isTimeZone, "Choose a valid time zone"),
  })
  .strict();
export type DateTimePreferences = z.infer<typeof dateTimePreferencesSchema>;

export const localizedTimestampSchema = z
  .object({
    date: z.string(),
    time: z.string().nullable(),
    dateTime: z.string().nullable(),
    timeZone: z.string(),
    zoneLabel: z.string(),
    epochMilliseconds: z.number(),
    inputDateTime: z.string().nullable(),
  })
  .strict();
export type LocalizedTimestamp = z.infer<typeof localizedTimestampSchema>;
export const dateTimeLocalizationSchema = z
  .object({
    dateFormat: dateTimePreferencesSchema.shape.dateFormat,
    timeFormat: dateTimePreferencesSchema.shape.timeFormat,
    timeZone: z.string(),
    timestamps: z.record(z.string(), localizedTimestampSchema),
  })
  .strict();
export type DateTimeLocalization = z.infer<typeof dateTimeLocalizationSchema>;

const instantPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const timestampInputSchema = z.iso.datetime({ offset: true });
const calendarDatePattern = /^\d{4}-\d{2}-\d{2}$/;

/** Server-side formatter. Clients consume the returned labels verbatim. */
export function createDateTimeFormatter(preferences: DateTimePreferences) {
  const numeric = new Intl.DateTimeFormat("en-GB", {
    timeZone: preferences.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  });
  const monthName = new Intl.DateTimeFormat("en-GB", {
    timeZone: preferences.timeZone,
    month: "short",
  });
  const calendarMonthName = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    month: "short",
  });
  return (value: string): LocalizedTimestamp | undefined => {
    const calendarDate = calendarDatePattern.test(value);
    if (
      !calendarDate &&
      (!instantPattern.test(value) ||
        !timestampInputSchema.safeParse(value).success)
    )
      return undefined;
    const instant = new Date(value);
    if (!Number.isFinite(instant.getTime())) return undefined;
    if (calendarDate && instant.toISOString().slice(0, 10) !== value)
      return undefined;
    const parts = Object.fromEntries(
      numeric.formatToParts(instant).map((part) => [part.type, part.value]),
    );
    const [year, month, day] = calendarDate
      ? value.split("-")
      : [parts.year, parts.month, parts.day];
    const shortMonth = (calendarDate ? calendarMonthName : monthName).format(
      instant,
    );
    const dates: Record<DateTimePreferences["dateFormat"], string> = {
      "day-short-month-year": `${Number(day)} ${shortMonth} ${year}`,
      "short-month-day-year": `${shortMonth} ${Number(day)}, ${year}`,
      "year-month-day": `${year}-${month}-${day}`,
      "day-month-year": `${day}/${month}/${year}`,
      "month-day-year": `${month}/${day}/${year}`,
    };
    const twelveHour = preferences.timeFormat.startsWith("12");
    const seconds = preferences.timeFormat.endsWith("seconds")
      ? `:${parts.second}`
      : "";
    const hour = Number(parts.hour);
    const time = `${twelveHour ? hour % 12 || 12 : parts.hour}:${parts.minute}${seconds}${twelveHour ? (hour < 12 ? " AM" : " PM") : ""}`;
    const date = dates[preferences.dateFormat];
    return {
      date,
      time: calendarDate ? null : time,
      dateTime: calendarDate ? null : `${time}, ${date}`,
      timeZone: preferences.timeZone,
      zoneLabel: calendarDate
        ? preferences.timeZone
        : (parts.timeZoneName ?? preferences.timeZone),
      epochMilliseconds: instant.getTime(),
      inputDateTime: calendarDate
        ? null
        : `${year}-${month}-${day}T${parts.hour}:${parts.minute}`,
    };
  };
}

export function localizeDateTimes(
  value: unknown,
  preferences: DateTimePreferences,
): DateTimeLocalization {
  const format = createDateTimeFormatter(preferences);
  const timestamps: Record<string, LocalizedTimestamp> = {};
  function visit(item: unknown) {
    if (item instanceof Date) {
      if (Number.isFinite(item.getTime())) visit(item.toISOString());
      return;
    }
    if (typeof item === "string") {
      if (timestamps[item]) return;
      const display = format(item);
      if (display) timestamps[item] = display;
    } else if (Array.isArray(item)) {
      item.forEach(visit);
    } else if (item && typeof item === "object") {
      for (const [key, child] of Object.entries(item)) {
        if (key !== "localization") visit(child);
      }
    }
  }
  visit(value);
  return { ...preferences, timestamps };
}

export function localizedResponse<T extends Record<string, unknown>>(
  value: T,
  preferences: DateTimePreferences,
) {
  return { ...value, localization: localizeDateTimes(value, preferences) };
}
