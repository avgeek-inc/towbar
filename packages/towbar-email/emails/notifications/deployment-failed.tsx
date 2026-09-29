import { OperationalEmail } from "../../src/index.js";

export default function Preview() {
  return (
    <OperationalEmail
      title="Deployment failed"
      summary="A deployment command failed during building. Open the deployment logs to see the cause before trying again."
      actionUrl="https://towbar.example.com/services/d90d0070-4179-495f-b5fa-42d7cc805180/deployments/c5542db1-3dc7-4123-bfa7-5664c54cf6ba"
      details={{
        name: "Storefront",
        repository: "avgeek-inc/storefront",
        commit: "cf1141873dd6",
        errorCode: "DEPLOYMENT_FAILED",
        environment: "production",
        deployableId: "d90d0070-4179-495f-b5fa-42d7cc805180",
        deployableKind: "app",
      }}
    />
  );
}
