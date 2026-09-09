import assert from "node:assert/strict";
import test from "node:test";
import { parseSecretEnv, serializeSecretEnv } from "./secret-env";

test("round trips values without interpolation or lost whitespace", () => {
  const values: Array<[string, string]> = [
    ["TOKEN", ' a#b=c\\d"e\nnext\t '],
    ["REF", "{{source.TOKEN}}"],
    ["EMPTY", ""],
    ["STARS", "********"],
  ];
  assert.deepEqual([...parseSecretEnv(serializeSecretEnv(values))], values);
});
test("treats empty and starred values literally", () => {
  const result = parseSecretEnv('CLEAR=""\nSTARS="********"');
  assert.equal(result.get("CLEAR"), "");
  assert.equal(result.get("STARS"), "********");
});
test("supports comments, export, CRLF, equals and multiline quotes", () => {
  const result = parseSecretEnv(
    "# comment\r\nexport URL=https://example.test/?a=b\r\nMULTI=\"first\nsecond\" # comment\nRAW=one # ignored\nSINGLE='a#b'",
  );
  assert.equal(result.get("URL"), "https://example.test/?a=b");
  assert.equal(result.get("MULTI"), "first\nsecond");
  assert.equal(result.get("RAW"), "one");
  assert.equal(result.get("SINGLE"), "a#b");
});
test("rejects duplicates, malformed lines, unclosed quotes and excess variables", () => {
  for (const text of [
    "A=1\nA=2",
    "BAD-KEY=1",
    "oops",
    'A="unclosed',
    'A="x" trailing',
    Array.from({ length: 201 }, (_, i) => `K${i}=x`).join("\n"),
  ])
    assert.throws(() => parseSecretEnv(text), /Line /);
});
test("does not expand references or treat prototype names specially", () => {
  assert.equal(
    parseSecretEnv("__proto__={{globals.TOKEN}}").get("__proto__"),
    "{{globals.TOKEN}}",
  );
});
