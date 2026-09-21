import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultDateTimePreferences,
  localizedResponse,
} from "@workspace/towbar-core/date-time";
import {
  clearDateTimeLabels,
  displayDateTime,
  localizationGeneration,
  localizationRevision,
  displayTimeZone,
  receiveDateTimeLabels,
} from "./date-time-display";

void test("UI reads server labels and discards responses from before a preference change or sign-out", () => {
  const timestamp = "2026-09-16T23:30:00Z";
  clearDateTimeLabels();
  const stale = localizationGeneration();
  receiveDateTimeLabels(
    localizedResponse({ timestamp }, defaultDateTimePreferences),
    stale,
  );
  assert.equal(displayDateTime(timestamp), "23:30, 16 Sept 2026");
  receiveDateTimeLabels(
    localizedResponse(
      { timestamp },
      { ...defaultDateTimePreferences, timeZone: "Asia/Kolkata" },
    ),
    stale,
  );
  assert.equal(displayDateTime(timestamp), "05:00, 17 Sept 2026");
  receiveDateTimeLabels(
    localizedResponse({ timestamp }, defaultDateTimePreferences),
    stale,
  );
  assert.equal(displayDateTime(timestamp), "05:00, 17 Sept 2026");
  clearDateTimeLabels();
  receiveDateTimeLabels(
    localizedResponse({ timestamp }, defaultDateTimePreferences),
    stale,
  );
  assert.equal(displayDateTime(timestamp), "—");
});

void test("preference changes with no timestamps still update subscribers and invalidate old labels", () => {
  clearDateTimeLabels();
  const old = localizationGeneration();
  receiveDateTimeLabels(
    localizedResponse(
      { timestamp: "2026-09-16T23:30:00Z" },
      defaultDateTimePreferences,
    ),
    old,
  );
  const before = localizationRevision();
  receiveDateTimeLabels(
    localizedResponse(
      {},
      { ...defaultDateTimePreferences, timeZone: "Pacific/Auckland" },
    ),
    old,
  );
  assert(localizationRevision() > before);
  assert.equal(displayTimeZone(), "Pacific/Auckland");
  assert.equal(displayDateTime("2026-09-16T23:30:00Z"), "—");
});
