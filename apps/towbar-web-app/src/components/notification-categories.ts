import {
  Activity01Icon,
  Alert02Icon,
  Archive01Icon,
  GitPullRequestIcon,
  Rocket01Icon,
  TestTube01Icon,
} from "@hugeicons/core-free-icons";
import type { NotificationCategory } from "@workspace/towbar-web-client";

export const notificationRoutingCategories = [
  {
    categories: ["scout"],
    icon: Alert02Icon,
    key: "scout",
    label: "Alerts & incidents",
  },
  {
    categories: ["deployments"],
    icon: Rocket01Icon,
    key: "deployments",
    label: "Deployment updates",
  },
  {
    categories: ["previews"],
    icon: GitPullRequestIcon,
    key: "previews",
    label: "Preview updates",
  },
  {
    categories: ["health"],
    icon: Activity01Icon,
    key: "health",
    label: "Service health",
  },
  {
    categories: ["backups", "restores"],
    icon: Archive01Icon,
    key: "backupsAndRestores",
    label: "Backups & restores",
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

export function notificationCategoryPresentation(category: string) {
  return notificationHistoryCategories.find((group) =>
    group.categories.some((value) => value === category),
  );
}
