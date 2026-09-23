"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Notification02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import Link from "next/link";

import type { NotificationEvent } from "@workspace/towbar-web-client";
import { usePageVisibilityInterval } from "@workspace/web-design-system/hooks/use-page-visibility-interval";
import { Widget } from "@workspace/web-design-system/data-display/widget";
import { Popover } from "@workspace/web-design-system/overlays/popover";
import { ScrollShadow } from "@workspace/web-design-system/utilities/scroll-shadow";
import { Button } from "@workspace/web-design-system/buttons/button";

import { api } from "@/lib/api";
import { notificationHref } from "@/lib/notification-route";
import { formatDate } from "./dashboard-overview";

const seenAtStorageKey = "towbar-notifications-seen-at";
const clearedAtStorageKey = "towbar-notifications-cleared-at";

type NotificationListResponse = { notifications: NotificationEvent[] };

export function NotificationCenter() {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [seenAt, setSeenAt] = useState(0);
  const [clearedAt, setClearedAt] = useState(0);

  useEffect(() => {
    const stored = Number(window.localStorage.getItem(seenAtStorageKey));
    if (Number.isFinite(stored) && stored > 0) {
      setSeenAt(stored);
    }
    const cleared = Number(window.localStorage.getItem(clearedAtStorageKey));
    if (Number.isFinite(cleared) && cleared > 0) {
      setClearedAt(cleared);
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get<NotificationListResponse>(
        "/v1/core/notifications?limit=20",
      );
      setNotifications(response.notifications);
    } catch {
      return;
    } finally {
      setLoading(false);
    }
  }, []);

  usePageVisibilityInterval(() => void refresh(), 30_000, {
    runImmediately: true,
  });

  useEffect(() => {
    if (isOpen) void refresh();
  }, [isOpen, refresh]);

  useEffect(() => {
    if (!isOpen || notifications.length === 0) return;
    const timer = window.setTimeout(() => {
      const nextSeenAt = Math.max(
        Date.now(),
        ...notifications.map((notification) =>
          new Date(notification.occurredAt).getTime(),
        ),
      );
      window.localStorage.setItem(seenAtStorageKey, String(nextSeenAt));
      setSeenAt(nextSeenAt);
    }, 3_000);
    return () => window.clearTimeout(timer);
  }, [isOpen, notifications]);

  const visibleNotifications = useMemo(
    () =>
      notifications.filter(
        (notification) =>
          new Date(notification.occurredAt).getTime() > clearedAt,
      ),
    [clearedAt, notifications],
  );
  const unreadCount = useMemo(
    () =>
      visibleNotifications.filter(
        (notification) => new Date(notification.occurredAt).getTime() > seenAt,
      ).length,
    [seenAt, visibleNotifications],
  );
  const clearAll = useCallback(() => {
    const nextClearedAt = Math.max(
      Date.now(),
      ...notifications.map((notification) =>
        new Date(notification.occurredAt).getTime(),
      ),
    );
    window.localStorage.setItem(clearedAtStorageKey, String(nextClearedAt));
    window.localStorage.setItem(seenAtStorageKey, String(nextClearedAt));
    setClearedAt(nextClearedAt);
    setSeenAt(nextClearedAt);
  }, [notifications]);

  return (
    <Popover isOpen={isOpen} onOpenChange={setIsOpen}>
      <Popover.Trigger
        aria-label={
          unreadCount > 0
            ? `Notifications, ${unreadCount} unread`
            : "Notifications"
        }
        className="relative isolate grid size-8 shrink-0 cursor-pointer touch-manipulation place-items-center rounded-full bg-default text-muted outline-none transition-[color,background-color,transform] hover:bg-default/80 hover:text-foreground active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
      >
        <HugeiconsIcon aria-hidden="true" icon={Notification02Icon} size={18} />
        {unreadCount > 0 ? (
          <span className="absolute end-0.5 top-0.5 grid min-h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[0.625rem] font-mono font-medium leading-4 text-danger-foreground">
            {Math.min(unreadCount, 9)}
          </span>
        ) : null}
      </Popover.Trigger>
      <Popover.Content
        className="w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-2xl bg-transparent p-0"
        placement="bottom end"
      >
        <Popover.Dialog className="p-0 outline-none">
          <Widget>
            <Widget.Header
              endContent={
                <Button
                  className="min-h-8 px-2 text-xs"
                  isDisabled={visibleNotifications.length === 0}
                  onPress={clearAll}
                  variant="ghost"
                >
                  Clear All
                </Button>
              }
            >
              <Popover.Heading className="flex min-w-0">
                <Widget.Title
                  icon={<HugeiconsIcon icon={Notification02Icon} />}
                >
                  Notifications
                </Widget.Title>
              </Popover.Heading>
            </Widget.Header>
            <Widget.Content className="p-0">
              <ScrollShadow className="max-h-[26rem]">
                {loading && notifications.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-muted">
                    Loading notifications…
                  </p>
                ) : visibleNotifications.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-muted">
                    No notifications yet
                  </p>
                ) : (
                  <ul className="divide-y divide-separator">
                    {visibleNotifications.map((notification) => (
                      <li key={notification.id}>
                        <Link
                          className="flex gap-3 rounded-xl px-4 py-3 outline-none transition-colors hover:bg-default/60 focus-visible:bg-default/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
                          href={notificationHref(notification)}
                          onClick={() => setIsOpen(false)}
                        >
                          <span
                            aria-hidden="true"
                            className={`mt-1 size-2 shrink-0 rounded-full ${notificationTone(notification.type)}`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-3">
                              <p className="text-sm font-medium">
                                {notification.payload.title}
                              </p>
                              <time
                                className="shrink-0 text-xs text-muted"
                                dateTime={notification.occurredAt}
                              >
                                {formatDate(notification.occurredAt)}
                              </time>
                            </div>
                            <p className="mt-0.5 text-sm text-muted">
                              {notification.payload.message}
                            </p>
                            <p className="mt-1 text-xs text-muted">
                              {notification.payload.source?.name ??
                                notification.payload.entity.name}
                            </p>
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </ScrollShadow>
            </Widget.Content>
          </Widget>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}

function notificationTone(type: string) {
  if (
    type.endsWith(".failed") ||
    type.endsWith(".stale") ||
    type.endsWith(".unhealthy") ||
    type.endsWith(".rolled_back")
  ) {
    return "bg-danger";
  }
  if (
    type.endsWith(".succeeded") ||
    type.endsWith(".recovered") ||
    type.endsWith(".ready")
  ) {
    return "bg-success";
  }
  return "bg-warning";
}
