import assert from "node:assert/strict";
import { test } from "node:test";
import { formatTableTime } from "./table-time";

const now = Date.parse("2026-09-05T07:30:00Z");

void test("table timestamps keep relative descriptions for recent and older dates", () => {
  assert.equal(
    formatTableTime("2026-09-05T07:25:00Z", now)?.relative,
    "5 minutes ago",
  );
  assert.equal(
    formatTableTime("2026-08-22T07:30:00Z", now)?.relative,
    "14 days ago",
  );
});
void test("expiry timestamps describe the future", () => {
  assert.equal(
    formatTableTime("2026-09-07T07:30:00Z", now)?.relative,
    "in 2 days",
  );
});
void test("server markup is timezone-explicit and stable until hydration", () => {
  assert.deepEqual(formatTableTime("2026-09-05T13:00:00+05:30", 0), {
    absolute: "5 Sept 2026, 07:30 UTC",
    relative: null,
  });
});
void test("malformed or empty timestamps do not crash a table", () => {
  assert.equal(formatTableTime("not a date", now), null);
  assert.equal(formatTableTime("", now), null);
});
