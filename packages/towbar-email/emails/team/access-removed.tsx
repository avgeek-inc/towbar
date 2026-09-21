import { TransactionalEmail } from "../../src/index.js";

export default function Preview() {
  return (
    <TransactionalEmail
      template="access-removed"
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
