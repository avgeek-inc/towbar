"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Notification02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import type { NotificationEvent } from "@workspace/towbar-web-client";
import { buttonVariants } from "@workspace/web-design-system/buttons/button";
import { usePageVisibilityInterval } from "@workspace/web-design-system/hooks/use-page-visibility-interval";
import { Popover } from "@workspace/web-design-system/overlays/popover";
import { ScrollShadow } from "@workspace/web-design-system/utilities/scroll-shadow";

import { api } from "@/lib/api";
import { formatDate } from "./dashboard-overview";

const seenAtStorageKey = "towbar-notifications-seen-at";

type NotificationListResponse = { notifications: NotificationEvent[] };

export function NotificationCenter() {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [seenAt, setSeenAt] = useState(0);

  useEffect(() => {
    const stored = Number(window.localStorage.getItem(seenAtStorageKey));
    if (Number.isFinite(stored) && stored > 0) {
      setSeenAt(stored);
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

  const unreadCount = useMemo(
    () =>
      notifications.filter(
        (notification) => new Date(notification.occurredAt).getTime() > seenAt,
      ).length,
    [notifications, seenAt],
  );

  return (
    <Popover isOpen={isOpen} onOpenChange={setIsOpen}>
      <Popover.Trigger
        aria-label={
          unreadCount > 0
            ? `Notifications, ${unreadCount} unread`
            : "Notifications"
        }
        className={buttonVariants({
          className: "relative size-10 min-h-10 min-w-10",
          isIconOnly: true,
          variant: "ghost",
        })}
      >
        <HugeiconsIcon aria-hidden="true" icon={Notification02Icon} size={20} />
        {unreadCount > 0 ? (
          <span className="absolute end-0.5 top-0.5 grid min-h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[0.625rem] font-medium leading-4 text-danger-foreground">
            {Math.min(unreadCount, 9)}
          </span>
        ) : null}
      </Popover.Trigger>
      <Popover.Content
        className="w-[min(24rem,calc(100vw-2rem))] p-0"
        placement="bottom end"
      >
        <Popover.Dialog className="outline-none">
          <div className="border-b border-separator px-4 py-3">
            <Popover.Heading className="font-medium">
              Notifications
            </Popover.Heading>
          </div>
          <ScrollShadow className="max-h-[26rem]">
            {loading && notifications.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted">
                Loading notifications…
              </p>
            ) : notifications.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted">
                No notifications yet
              </p>
            ) : (
              <ul className="divide-y divide-separator">
                {notifications.map((notification) => (
                  <li className="flex gap-3 px-4 py-3" key={notification.id}>
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
                        {notification.payload.source.name}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </ScrollShadow>
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
