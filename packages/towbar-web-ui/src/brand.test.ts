import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { TowbarLockup } from "./brand.js";

Object.assign(globalThis, { React });

void test("Towbar lockup uses the Towbar brand assets", () => {
  const markup = renderToStaticMarkup(React.createElement(TowbarLockup));

  assert.match(markup, /brands\/towbar\/logo\/light-transparent-edge/u);
  assert.match(markup, /brands\/towbar\/logo\/dark-transparent-edge/u);
  assert.doesNotMatch(markup, /brands\/company\/logo/u);
  assert.match(markup, />Towbar<\/span>/u);
});
