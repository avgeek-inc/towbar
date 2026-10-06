"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { NotificationEvent } from "@workspace/towbar-web-client";
import { usePageVisibilityInterval } from "@avgeek-oss/design-system/hooks/use-page-visibility-interval";
import { NotificationMenu } from "@avgeek-oss/design-system/patterns/notifications";
import { Button } from "@avgeek-oss/design-system/buttons/button";

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
    <NotificationMenu
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      unreadCount={unreadCount}
      loading={loading && notifications.length === 0}
      headerEnd={
        <Button
          className="min-h-8 px-2 text-xs"
          isDisabled={visibleNotifications.length === 0}
          onPress={clearAll}
          variant="ghost"
        >
          Clear All
        </Button>
      }
      items={visibleNotifications.map((notification) => ({
        id: notification.id,
        title: notification.payload.title,
        message: notification.payload.message,
        source:
          notification.payload.source?.name ?? notification.payload.entity.name,
        href: notificationHref(notification),
        icon: (
          <span
            className={`mt-1 size-2 rounded-full ${notificationTone(notification.type)}`}
          />
        ),
        time: formatDate(notification.occurredAt),
        dateTime: notification.occurredAt,
        unread: new Date(notification.occurredAt).getTime() > seenAt,
      }))}
    />
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
