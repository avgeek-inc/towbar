import {
  Add01Icon,
  Alert02Icon,
  AlertCircleIcon,
  Analytics01Icon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowUp01Icon,
  BookOpen01Icon,
  Download01Icon,
  RefreshIcon,
  Calendar03Icon,
  Cancel01Icon,
  ChartIncreaseIcon,
  CheckmarkCircle01Icon,
  Clock01Icon,
  DashboardCircleIcon,
  DatabaseIcon,
  Delete02Icon,
  Edit02Icon,
  FilterIcon,
  GitCompareIcon,
  Globe02Icon,
  Layers01Icon,
  GitBranchIcon,
  PlayIcon,
  Mail01Icon,
  Notification01Icon,
  NotificationOff01Icon,
  Rocket01Icon,
  SaveIcon,
  ServerStack01Icon,
  SlackIcon,
  TestTubeIcon,
  ViewIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { MonitoringMetricIcon } from "./monitoring-metric-icon";

const icons = {
  healthy: CheckmarkCircle01Icon,
  unhealthy: AlertCircleIcon,
  unknown: Clock01Icon,
  none: Cancel01Icon,
  missing: AlertCircleIcon,
  ready: CheckmarkCircle01Icon,
  pending: Clock01Icon,
  preparing: RefreshIcon,
  failed: AlertCircleIcon,
  queued: Clock01Icon,
  succeeded: CheckmarkCircle01Icon,
  never: Clock01Icon,
  running: PlayIcon,
  stopped: Cancel01Icon,
  starting: RefreshIcon,
  installing: RefreshIcon,
  uninstalling: RefreshIcon,
  waiting: Clock01Icon,
  enabled: CheckmarkCircle01Icon,
  disabled: Cancel01Icon,
  paused: Cancel01Icon,
  online: CheckmarkCircle01Icon,
  offline: AlertCircleIcon,
  error: AlertCircleIcon,
  postgres: DatabaseIcon,
  redis: DatabaseIcon,
  image: Layers01Icon,
  source: GitBranchIcon,
  add: Add01Icon,
  docs: BookOpen01Icon,
  install: Download01Icon,
  refresh: RefreshIcon,
  edit: Edit02Icon,
  delete: Delete02Icon,
  mute: NotificationOff01Icon,
  notifications: Notification01Icon,
  test: TestTubeIcon,
  save: SaveIcon,
  close: Cancel01Icon,
  view: ViewIcon,
  previous: ArrowLeft01Icon,
  next: ArrowRight01Icon,
  performance: Analytics01Icon,
  alerts: Alert02Icon,
  compare: GitCompareIcon,
  average: Analytics01Icon,
  peak: ChartIncreaseIcon,
  time: Clock01Icon,
  date: Calendar03Icon,
  warning: Alert02Icon,
  critical: AlertCircleIcon,
  above: ArrowUp01Icon,
  below: ArrowDown01Icon,
  production: ServerStack01Icon,
  preview: Rocket01Icon,
  server: ServerStack01Icon,
  app: DashboardCircleIcon,
  resource: DatabaseIcon,
  all: Layers01Icon,
  active: AlertCircleIcon,
  resolved: CheckmarkCircle01Icon,
  filter: FilterIcon,
  slack: SlackIcon,
  smtp: Mail01Icon,
  http: Globe02Icon,
};
export function ScoutIcon({ name }: { name: keyof typeof icons }) {
  return (
    <HugeiconsIcon
      icon={icons[name]}
      aria-hidden="true"
      className={`size-4 shrink-0 ${name === "warning" ? "text-warning" : name === "critical" ? "text-danger" : ""}`}
    />
  );
}
export function ScoutOptionIcon({
  value,
  label,
}: {
  value: string;
  label: string;
}) {
  if (label === "Metric") {
    if (value === "httpAvailability") return <ScoutIcon name="http" />;
    if (value === "missingReports") return <ScoutIcon name="time" />;
    if (value === "restarts") return <ScoutIcon name="refresh" />;
    return <MonitoringMetricIcon metric={value} />;
  }
  if (label === "Method") return <ScoutIcon name="http" />;
  if (label === "Time range" || label === "Mute duration")
    return <ScoutIcon name="time" />;
  if (label === "Baseline" || label === "Compare with")
    return <ScoutIcon name="preview" />;
  if (value !== "all" && label === "Source") return <ScoutIcon name="source" />;
  if (value !== "all" && label === "Server") return <ScoutIcon name="server" />;
  const key = value.split(":")[0]!;
  return (
    <ScoutIcon
      name={Object.hasOwn(icons, key) ? (key as keyof typeof icons) : "all"}
    />
  );
}
