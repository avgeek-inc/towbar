import assert from "node:assert/strict";
import test from "node:test";
import {
  createDateTimeFormatter,
  dateFormatOptions,
  dateTimePreferencesSchema,
  defaultDateTimePreferences,
  localizedResponse,
  timeFormatOptions,
} from "./date-time.js";

void test("every date and time preset is rendered on the server", () => {
  const instant = "2026-09-16T14:30:45Z";
  for (const date of dateFormatOptions)
    for (const time of timeFormatOptions) {
      const display = createDateTimeFormatter({
        dateFormat: date.id,
        timeFormat: time.id,
        timeZone: "UTC",
      })(instant)!;
      assert.equal(display.date, date.label);
      assert.equal(display.time, time.label);
      assert.equal(display.dateTime, `${time.label}, ${date.label}`);
      assert.equal(display.timeZone, "UTC");
    }
});
void test("non-hour-offset zones move dates correctly, while calendar dates do not shift", () => {
  const format = createDateTimeFormatter({
    ...defaultDateTimePreferences,
    timeZone: "Asia/Kathmandu",
  });
  assert.equal(format("2026-09-16T23:30:00Z")?.dateTime, "05:15, 17 Sept 2026");
  assert.equal(format("2026-09-16")?.date, "16 Sept 2026");
  assert.equal(format("2026-09-16")?.time, null);
  assert.equal(
    format("2026-09-16T23:30:00Z")?.inputDateTime,
    "2026-09-17T05:15",
  );
});
void test("DST instants retain distinct offsets even when the wall time repeats", () => {
  const format = createDateTimeFormatter({
    ...defaultDateTimePreferences,
    timeZone: "America/New_York",
  });
  const before = format("2026-11-01T05:30:00Z")!;
  const after = format("2026-11-01T06:30:00Z")!;
  assert.equal(before.time, after.time);
  assert.notEqual(before.zoneLabel, after.zoneLabel);
  assert.notEqual(before.epochMilliseconds, after.epochMilliseconds);
  assert.equal(format("2026-03-08T06:59:00Z")?.time, "01:59");
  assert.equal(format("2026-03-08T07:00:00Z")?.time, "03:00");
});
void test("responses preserve raw timestamps and localize nested arrays without interpreting prose", () => {
  const body = {
    items: [
      { createdAt: "2026-09-16T14:30:45Z", description: "Updated yesterday" },
    ],
    absent: null,
  };
  const response = localizedResponse(body, defaultDateTimePreferences);
  assert.deepEqual(response.items, body.items);
  assert.equal(Object.keys(response.localization.timestamps).length, 1);
  assert.equal(
    response.localization.timestamps[body.items[0]!.createdAt]!.dateTime,
    "14:30, 16 Sept 2026",
  );
});
void test("invalid preferences and invalid calendar dates are rejected", () => {
  for (const preferences of [
    { ...defaultDateTimePreferences, timeZone: "not/a-zone" },
    { ...defaultDateTimePreferences, timeZone: "+05:30" },
    { ...defaultDateTimePreferences, dateFormat: "custom" },
    { ...defaultDateTimePreferences, userId: "another-user" },
  ])
    assert.equal(
      dateTimePreferencesSchema.safeParse(preferences).success,
      false,
    );
  const format = createDateTimeFormatter(defaultDateTimePreferences);
  assert.equal(format("2026-02-30"), undefined);
  assert.equal(format("invalid"), undefined);
  assert.equal(format("2026-09-16T14:30:00"), undefined);
  assert.equal(format("2026-02-30T14:30:00Z"), undefined);
  assert.equal(format("2026-09-16T24:30:00Z"), undefined);
});

void test("database Date values serialize with labels keyed by the original ISO timestamp", () => {
  const createdAt = new Date("2026-09-16T23:30:45.123Z");
  const response = localizedResponse({ createdAt }, defaultDateTimePreferences);
  const wire = JSON.parse(JSON.stringify(response));
  assert.equal(wire.createdAt, createdAt.toISOString());
  assert.equal(
    wire.localization.timestamps[wire.createdAt].dateTime,
    "23:30, 16 Sept 2026",
  );
  assert.equal(
    wire.localization.timestamps[wire.createdAt].epochMilliseconds,
    createdAt.getTime(),
  );
});
