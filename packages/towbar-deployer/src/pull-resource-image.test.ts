import assert from "node:assert/strict";
import test from "node:test";

import { pullResourceImageScript } from "./pull-resource-image.js";

void test("wraps pinned Resource images with Source ownership labels", () => {
  assert.match(pullResourceImageScript, /docker pull "\$base_image"/);
  assert.match(pullResourceImageScript, /towbar\.managed=true/);
  assert.match(pullResourceImageScript, /towbar\.source=\$source_id/);
  assert.match(pullResourceImageScript, /towbar\.deployable=\$deployable_id/);
  assert.match(pullResourceImageScript, /-t "\$image_tag"/);
  assert.match(pullResourceImageScript, /ARG BASE_IMAGE=busybox:stable/);
});
