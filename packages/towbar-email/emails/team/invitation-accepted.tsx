import { TransactionalEmail } from "../../src/index.js";

export default function Preview() {
  return (
    <TransactionalEmail
      template="invitation-accepted"
      data={{
        name: "Alex Morgan",
        teamName: "Acme",
        role: "member",
        previousRole: "viewer",
        keyName: "Production automation",
      }}
    />
  );
}
