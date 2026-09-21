import { TransactionalEmail } from "../../src/index.js";

export default function Preview() {
  return (
    <TransactionalEmail
      template="email-change-verification"
      data={{
        name: "Alex Morgan",
        teamName: "Acme",
        role: "member",
        previousRole: "viewer",
        keyName: "Production automation",
        actionUrl:
          "https://towbar.example.com/confirm-email-change#token=preview-only",
      }}
    />
  );
}
