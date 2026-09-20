import { TransactionalEmail } from "../../src/index.js";

export default function Preview() {
  return (
    <TransactionalEmail
      template="password-reset"
      data={{
        name: "Alex Morgan",
        teamName: "Acme",
        role: "member",
        previousRole: "viewer",
        keyName: "Production automation",
        actionUrl:
          "https://towbar.example.com/reset-password#token=preview-only",
      }}
    />
  );
}
