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
    assert.match(mail.text.split("\n", 1)[0] ?? "", /[.!?]$/);
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
