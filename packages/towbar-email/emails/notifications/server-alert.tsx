import { OperationalEmail } from "../../src/index.js";

export default function Preview() {
  return (
    <OperationalEmail
      {...{
        title: "High disk usage",
        summary:
          "Disk usage on the production server exceeded the configured threshold.",
        actionUrl:
          "https://towbar.example.com/monitoring/incidents/preview-incident",
        details: {
          Server: "192.0.2.10",
          "Disk usage": "93.4%",
          Threshold: "90%",
          State: "Open",
        },
      }}
    />
  );
}
