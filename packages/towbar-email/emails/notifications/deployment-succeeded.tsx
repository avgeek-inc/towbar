import { OperationalEmail } from "../../src/index.js";

export default function Preview() {
  return (
    <OperationalEmail
      {...{
        title: "Deployment succeeded",
        summary: "Storefront is serving the new deployment in production.",
        actionUrl:
          "https://towbar.example.com/apps/preview-app/deployments/preview-deployment",
        details: {
          App: "Storefront",
          Environment: "production",
          Commit: "a81c4e2",
          Duration: "42 seconds",
        },
      }}
    />
  );
}
