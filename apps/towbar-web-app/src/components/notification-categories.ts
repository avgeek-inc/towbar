import {
  Alert02Icon,
  Archive01Icon,
  Rocket01Icon,
  TestTube01Icon,
} from "@hugeicons/core-free-icons";
import type { NotificationCategory } from "@workspace/towbar-web-client";

const notificationRoutingCategories = [
  {
    categories: ["health", "scout"],
    icon: Alert02Icon,
    key: "scout",
    label: "Incidents",
  },
  {
    categories: ["deployments"],
    icon: Rocket01Icon,
    key: "deployments",
    label: "Deployments (All)",
  },
  {
    categories: ["deploymentFailures"],
    icon: Rocket01Icon,
    key: "deploymentFailures",
    label: "Deployments (Failures)",
  },
  {
    categories: ["backups", "restores"],
    icon: Archive01Icon,
    key: "backupsAndRestores",
    label: "Backup & Restore",
  },
] as const satisfies Array<{
  categories: NotificationCategory[];
  icon: typeof Alert02Icon;
  key: string;
  label: string;
}>;

export const notificationHistoryCategories = [
  ...notificationRoutingCategories,
  {
    categories: ["test"],
    icon: TestTube01Icon,
    key: "test",
    label: "Test notifications",
  },
] as const;

export function notificationCategoryPresentation(
  category: string,
  type?: string,
) {
  if (type === "deployment.failed" || type === "preview.failed")
    return notificationHistoryCategories.find(
      (group) => group.key === "deploymentFailures",
    );
  if (category === "previews")
    return notificationHistoryCategories.find(
      (group) => group.key === "deployments",
    );
  return notificationHistoryCategories.find((group) =>
    group.categories.some((value) => value === category),
  );
}
