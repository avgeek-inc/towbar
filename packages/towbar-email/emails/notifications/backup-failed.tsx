import { OperationalEmail } from "../../src/index.js";

export default function Preview() {
  return (
    <OperationalEmail
      {...{
        title: "Database backup failed",
        summary:
          "The scheduled backup of Primary Postgres could not be uploaded. Review the storage configuration and retry.",
        actionUrl:
          "https://towbar.example.com/resources/preview-database/backups",
        details: {
          Resource: "Primary Postgres",
          Environment: "production",
          Destination: "AWS S3",
          Reason: "Access denied",
        },
      }}
    />
  );
}
