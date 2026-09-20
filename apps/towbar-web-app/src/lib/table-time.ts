import { formatDistanceStrict } from "date-fns/formatDistanceStrict";
import { dateTimeLabel } from "./date-time-display";

export function formatTableTime(value: string, now: number) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const display = dateTimeLabel(value);
  return {
    absolute: display?.dateTime ?? display?.date ?? "—",
    timezone: display?.timeZone ?? "",
    relative: now ? formatDistanceStrict(date, now, { addSuffix: true }) : null,
  };
}
