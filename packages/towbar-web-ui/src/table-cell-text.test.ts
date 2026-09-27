import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { TableCellDescription } from "./table-cell-text.js";

Object.assign(globalThis, { React });

void test("table descriptions preserve up to 64 characters and cap longer text including the ellipsis", () => {
  for (const length of [63, 64, 65]) {
    const text = "a".repeat(length);
    const markup = renderToStaticMarkup(
      React.createElement(TableCellDescription, null, text),
    );
    const expected = length > 64 ? `${"a".repeat(63)}…` : text;
    assert(markup.endsWith(`>${expected}</span>`));
    assert.equal(markup.includes(`title="${text}"`), length > 64);
  }
});

void test("truncation keeps Unicode characters intact and preserves an explicit hover title", () => {
  const text = "🚀".repeat(65);
  const markup = renderToStaticMarkup(
    React.createElement(
      TableCellDescription,
      { title: "Full description" },
      text,
    ),
  );
  assert(markup.endsWith(`>${"🚀".repeat(63)}…</span>`));
  assert.match(markup, /title="Full description"/);
});

void test("rich descriptions retain their elements and link destinations", () => {
  const markup = renderToStaticMarkup(
    React.createElement(
      TableCellDescription,
      null,
      React.createElement("a", { href: "/services/example" }, "Service"),
    ),
  );
  assert.match(markup, /<a href="\/services\/example">Service<\/a>/);
});
