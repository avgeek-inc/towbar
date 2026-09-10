import assert from "node:assert/strict";
import test from "node:test";
import { selectObsoletePreviewApps } from "./cleanup-selection.js";

const app = {
  appId: "site-stage",
  environmentId: "staging",
  archived: false,
  enabled: true,
};

void test("cleans the former environment after a PR is retargeted", () => {
  assert.deepEqual(
    selectObsoletePreviewApps({
      existing: [app],
      targetEnvironmentIds: ["production"],
      evaluatedAppIds: [],
      relevantAppIds: [],
    }),
    [app.appId],
  );
});

void test("cleans removed, disabled and nonmatching PR apps while retaining relevant apps", () => {
  const existing = [
    app,
    { ...app, appId: "removed" },
    { ...app, appId: "disabled", enabled: false },
    { ...app, appId: "archived", archived: true },
  ];
  assert.deepEqual(
    selectObsoletePreviewApps({
      existing,
      targetEnvironmentIds: ["staging"],
      evaluatedAppIds: [app.appId, "removed"],
      relevantAppIds: [app.appId],
    }),
    ["removed", "disabled", "archived"],
  );
});

void test("preserves matching previews when a changed mapping or unready server prevents evaluation", () => {
  assert.deepEqual(
    selectObsoletePreviewApps({
      existing: [app],
      targetEnvironmentIds: ["staging"],
      evaluatedAppIds: [],
      relevantAppIds: [],
    }),
    [],
  );
});

void test("cleans disconnected targets once per app", () => {
  assert.deepEqual(
    selectObsoletePreviewApps({
      existing: [app, app],
      targetEnvironmentIds: [],
      evaluatedAppIds: [],
      relevantAppIds: [],
    }),
    [app.appId],
  );
});
