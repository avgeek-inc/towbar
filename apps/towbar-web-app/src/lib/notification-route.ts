import type { NotificationEvent } from "@workspace/towbar-web-client";

export function notificationHref(
  notification: Pick<NotificationEvent, "payload" | "type">,
) {
  const { details, entity, source } = notification.payload;
  const configuredRoute = routeFromConfiguration(details.configuration);
  if (configuredRoute) return configuredRoute;

  if (entity.kind === "deployment") {
    const deployableId = stringDetail(details.deployableId);
    const deployableKind = stringDetail(details.deployableKind);
    if (deployableId && deployableKind) {
      const collection = deployableKind === "app" ? "apps" : "resources";
      return `/${collection}/${deployableId}/deployments/${entity.id}`;
    }
    if (source) return `/repositories/${source.id}/deployments/${entity.id}`;
    return "/deployments";
  }
  if (entity.kind === "preview")
    return source ? `/repositories/${source.id}/environments` : "/apps";
  if (entity.kind === "server") {
    if (notification.type.startsWith("log-drain."))
      return "/manage/integrations";
    if (notification.type.startsWith("scout."))
      return `/servers/${entity.id}/incidents`;
    if (notification.type.startsWith("server.maintenance."))
      return `/servers/${entity.id}/checks`;
    return `/servers/${entity.id}/overview`;
  }
  if (entity.kind === "app") return `/apps/${entity.id}/overview`;
  if (entity.kind === "resource") return `/resources/${entity.id}/overview`;
  if (entity.kind === "backup") return `/resources/${entity.id}/backup`;
  if (entity.kind === "restore") return `/resources/${entity.id}/restore`;
  if (entity.kind === "source")
    return `/repositories/${entity.id}/environments`;
  return "/manage/notifications";
}

function stringDetail(value: boolean | number | string | null | undefined) {
  return typeof value === "string" && value ? value : undefined;
}

function routeFromConfiguration(
  value: boolean | number | string | null | undefined,
) {
  const configuration = stringDetail(value);
  if (!configuration) return undefined;
  try {
    const url = new URL(configuration, "https://towbar.invalid");
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return undefined;
  }
}
