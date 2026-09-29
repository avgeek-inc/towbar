import { OperationalEmail } from "../../src/index.js";

export default function Preview() {
  return (
    <OperationalEmail
      {...{
        title: "Alert: Production server / CPU alert",
        summary:
          "Production server / CPU alert needs attention on 203.0.113.10.",
        actionUrl:
          "https://towbar.example.com/servers/efb69b04-1015-4b37-b4c2-c9190c6fc645/incidents",
        details: {
          name: "Production server",
          value: 97.29368526561977,
          metric: "cpuPercent",
          ruleId: "e4b22c79-a3e9-44a4-ad9b-83d6bdd7cc9d",
          severity: "critical",
          threshold: 80,
          incidentId: "699e907e-6da5-443c-af3a-47262edead88",
          environment: "production",
          performance:
            "https://towbar.example.com/servers/efb69b04-1015-4b37-b4c2-c9190c6fc645/performance",
        },
      }}
    />
  );
}
