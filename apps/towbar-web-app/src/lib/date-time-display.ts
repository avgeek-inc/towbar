import type {
  DateTimeLocalization,
  LocalizedTimestamp,
} from "@workspace/towbar-web-client";

const labels = new Map<string, LocalizedTimestamp>();
let generation = 0;
let preferencesKey: string | undefined;
let timeZone: string | undefined;
const subscribers = new Set<() => void>();
let revision = 0;

export const localizationGeneration = () => generation;
export const localizationRevision = () => revision;
export const serverLocalizationRevision = () => 0;
export function subscribeLocalization(callback: () => void) {
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}
function notify() {
  revision++;
  for (const callback of subscribers) callback();
}
export function clearDateTimeLabels() {
  generation++;
  labels.clear();
  preferencesKey = undefined;
  timeZone = undefined;
  notify();
}

export function receiveDateTimeLabels(
  payload: unknown,
  requestGeneration: unknown,
) {
  if (
    requestGeneration !== generation ||
    !payload ||
    typeof payload !== "object" ||
    !("localization" in payload)
  )
    return;
  const localization = payload.localization as DateTimeLocalization | undefined;
  if (!localization?.timestamps || !localization.timeZone) return;
  const key = `${localization.dateFormat}:${localization.timeFormat}:${localization.timeZone}`;
  const preferencesChanged = Boolean(preferencesKey && preferencesKey !== key);
  let changed = preferencesKey !== key;
  if (preferencesChanged) {
    labels.clear();
    generation++;
  }
  preferencesKey = key;
  timeZone = localization.timeZone;
  for (const [timestamp, value] of Object.entries(localization.timestamps)) {
    if (JSON.stringify(labels.get(timestamp)) !== JSON.stringify(value))
      changed = true;
    labels.set(timestamp, value);
    if (value.time !== null) labels.set(String(value.epochMilliseconds), value);
  }
  // Bound the cache independently of retained monitoring history on the server.
  while (labels.size > 50_000) labels.delete(labels.keys().next().value!);
  if (changed) notify();
  return preferencesChanged;
}

export function dateTimeLabel(value: string | number | null | undefined) {
  return value == null ? undefined : labels.get(String(value));
}
export function displayDateTime(value: string | number | null | undefined) {
  const localized = dateTimeLabel(value);
  return localized?.dateTime ?? localized?.date ?? "—";
}
export function displayDate(value: string | number | null | undefined) {
  return dateTimeLabel(value)?.date ?? "—";
}
export function displayChartDate(value: string | number | null | undefined) {
  // Keep the server-localized date order and time zone, omitting only the year.
  return displayDate(value)
    .replace(/^\d{4}-/, "")
    .replace(/(?:,\s*|\s+|\/)\d{4}$/, "");
}
export function displayTime(value: string | number | null | undefined) {
  return dateTimeLabel(value)?.time ?? "—";
}
export function displayTimeZone() {
  return timeZone ?? "—";
}
