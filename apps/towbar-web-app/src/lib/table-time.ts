import { formatDistanceStrict } from "date-fns/formatDistanceStrict";

const dateOptions: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZoneName: "short",
};
const localFormatter = new Intl.DateTimeFormat("en-GB", dateOptions);
const serverFormatter = new Intl.DateTimeFormat("en-GB", {
  ...dateOptions,
  timeZone: "UTC",
});

export function formatTableTime(value: string, now: number) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return {
    absolute: (now ? localFormatter : serverFormatter).format(date),
    relative: now ? formatDistanceStrict(date, now, { addSuffix: true }) : null,
  };
}
