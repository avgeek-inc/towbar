import assert from "node:assert/strict";
import test from "node:test";
import {
  renderOperationalEmail,
  renderTransactionalEmail,
  transactionalTemplates,
} from "./index.js";
for (const template of transactionalTemplates) {
  test(`${template} renders escaped HTML and useful plain text`, async () => {
    const mail = await renderTransactionalEmail(template, {
      name: '<script>alert("user")</script>',
      teamName: "Product & <Research>",
      role: "viewer",
      keyName: "<img src=x onerror=alert(1)>",
      actionUrl: "https://towbar.example.test/invite/a-safe-example",
      verificationCode: "314159",
    });
    assert(mail.subject.startsWith("[Towbar] "));
    const preview = mail.html.match(/data-skip-in-text="true">([^<]+)/)?.[1];
    assert.match(preview ?? "", /[.!?]$/);
    assert.notEqual(preview, mail.subject.replace(/^\[Towbar\] /, ""));
    if (!template.startsWith("team-key-"))
      assert.match(mail.text, /Hello <script>alert\("user"\)<\/script>,/);
    else assert.match(mail.text.split("\n", 1)[0] ?? "", /[.!?]$/);
    assert(mail.html.includes("Product &amp; &lt;Research&gt;"));
    assert(!mail.html.includes("<script>"));
    assert(!mail.html.includes("<img src=x"));
    assert(mail.text.includes("Product & <Research>"));
    const actionUrl = mail.text
      .split(/\s+/u)
      .filter((value) => URL.canParse(value))
      .map((value) => new URL(value))
      .find(
        (value) =>
          value.protocol === "https:" &&
          value.hostname === "towbar.example.test" &&
          value.pathname === "/invite/a-safe-example",
      );
    assert.equal(
      actionUrl?.href,
      "https://towbar.example.test/invite/a-safe-example",
    );
  });
}
test("operational email previews use a complete sentence", async () => {
  const mail = await renderOperationalEmail({
    title: "Deployment succeeded",
    summary: "The app is ready",
    actionUrl: "https://towbar.example.test/deployments/example",
    details: {},
  });
  assert.match(mail.html, /data-skip-in-text="true">The app is ready\./);
  assert.match(mail.text, /^The app is ready\./);
});
test("email actions cannot contain executable URLs", async () => {
  await assert.rejects(
    renderTransactionalEmail("invitation", {
      teamName: "Example",
      actionUrl: "javascript:alert(1)",
    }),
  );
});

test("alert email details show metric names, rounded units, and compact references", async () => {
  const mail = await renderOperationalEmail({
    title: "CPU alert",
    summary: "The production server needs attention.",
    actionUrl: "https://towbar.example.test/servers/example/incidents",
    details: {
      value: 97.29368526561977,
      metric: "cpuPercent",
      threshold: 80,
      severity: "critical",
      incidentId: "699e907e-6da5-443c-af3a-47262edead88",
      performance: "https://towbar.example.test/servers/example/performance",
    },
  });
  assert.match(mail.text, /CPU usage: 97\.3%/u);
  assert.match(mail.text, /Threshold: 80%/u);
  assert.match(mail.text, /Severity: Critical/u);
  assert.match(mail.text, /Incident ID: 699e907e-6da5-443c-af3a-47262edead88/u);
  assert.match(mail.html, /699e907e…/u);
  assert.match(mail.html, /View performance/u);
  assert.doesNotMatch(mail.html, /97\.293685|cpuPercent|incidentId/u);
});

test("deployment email labels are readable and long values remain escaped", async () => {
  const mail = await renderOperationalEmail({
    title: "Deployment failed",
    summary: "A deployment command failed during building.",
    actionUrl: "https://towbar.example.test/deployments/example",
    details: {
      errorCode: "DEPLOYMENT_FAILED",
      deployableId: "d90d0070-4179-495f-b5fa-42d7cc805180",
      deployableKind: "app",
      environment: "production",
      note: `<script>${"a".repeat(100)}</script>`,
      upperCaseNote: "<SCRIPT>alert(1)</SCRIPT>",
      configuration: "javascript:alert(1)",
    },
  });
  assert.match(mail.text, /Error code: DEPLOYMENT_FAILED/u);
  assert.match(mail.text, /Deployable ID:/u);
  assert.match(mail.text, /Deployable type: Service/u);
  assert.match(mail.text, /Environment: Production/u);
  assert.doesNotMatch(mail.html, /<script>|href="javascript:/iu);
  assert.match(mail.html, /d90d0070…/u);
  assert.match(mail.html, /&lt;script&gt;/u);
  assert.match(mail.html, /&lt;SCRIPT&gt;/u);
});
