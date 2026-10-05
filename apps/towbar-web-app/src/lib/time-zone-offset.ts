export function timeZoneOffset(timeZone: string, instant: Date) {
  const offset = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  })
    .formatToParts(instant)
    .find((part) => part.type === "timeZoneName")!.value;
  return (offset.replace(/^GMT/, "") || "+00:00").replace("-", "−");
}
