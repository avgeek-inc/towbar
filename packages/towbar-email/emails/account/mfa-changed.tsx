import { TransactionalEmail } from "../../src/index.js";

export default function Preview() {
  return (
    <TransactionalEmail
      template="mfa-changed"
      data={{
        name: "Alex Morgan",
        teamName: "Acme",
        role: "member",
        previousRole: "viewer",
        keyName: "Production automation",
        actionUrl: "https://towbar.example.com/settings/2fa",
      }}
    />
  );
}
