import assert from "node:assert/strict";
import test from "node:test";
import { renderTransactionalEmail, transactionalTemplates } from "./index.js";
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
    assert(mail.html.includes("Product &amp; &lt;Research&gt;"));
    assert(!mail.html.includes("<script>"));
    assert(!mail.html.includes("<img src=x"));
    assert(mail.text.includes("Product & <Research>"));
    assert(
      mail.text
        .split(/\s+/u)
        .includes("https://towbar.example.test/invite/a-safe-example"),
    );
  });
}
test("email actions cannot contain executable URLs", async () => {
  await assert.rejects(
    renderTransactionalEmail("invitation", {
      teamName: "Example",
      actionUrl: "javascript:alert(1)",
    }),
  );
});
