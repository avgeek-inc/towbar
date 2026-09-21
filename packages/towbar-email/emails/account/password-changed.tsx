import { TransactionalEmail } from "../../src/index.js";

export default function Preview() {
  return (
    <TransactionalEmail
      template="password-changed"
      data={{
        name: "Alex Morgan",
        teamName: "Acme",
        role: "member",
        previousRole: "viewer",
        keyName: "Production automation",
        actionUrl: "https://towbar.example.com/settings/email-password",
      }}
    />
  );
}
