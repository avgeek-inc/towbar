"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { NotificationEvent } from "@workspace/towbar-web-client";
import { usePageVisibilityInterval } from "@avgeek-oss/design-system/hooks/use-page-visibility-interval";
import { NotificationMenu } from "@avgeek-oss/design-system/patterns/notifications";
import { Widget } from "@avgeek-oss/design-system/data-display/widget";
import { toast } from "@avgeek-oss/design-system/overlays/toast";
import { api } from "@/lib/api";
import { notificationHref } from "@/lib/notification-route";
import { formatDate } from "./dashboard-overview";

type NotificationPage = {
  notifications: (NotificationEvent & { readAt: string | null })[];
  nextCursor: { before: string; beforeId: string } | null;
  unreadCount: number;
};

export function NotificationCenter() {
  const [isOpen, setIsOpen] = useState(false);
  const [feed, setFeed] = useState<NotificationPage>({
    notifications: [],
    nextCursor: null,
    unreadCount: 0,
  });
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [markingRead, setMarkingRead] = useState(false);
  const pageCount = useRef(1);
  const generation = useRef(0);
  const mutationPending = useRef(false);
  const paginationPending = useRef(false);

  const refresh = useCallback(async () => {
    const requestGeneration = ++generation.current;
    setLoading(true);
    try {
      let page = await api.get<NotificationPage>(
        "/v1/core/notifications?limit=50",
      );
      const notifications = [...page.notifications];
      const unreadCount = page.unreadCount;
      for (
        let index = 1;
        index < pageCount.current && page.nextCursor;
        index++
      ) {
        const query = new URLSearchParams({ limit: "50", ...page.nextCursor });
        page = await api.get<NotificationPage>(
          `/v1/core/notifications?${query}`,
        );
        notifications.push(...page.notifications);
      }
      if (generation.current === requestGeneration) {
        setFeed({
          ...page,
          unreadCount,
          notifications: [
            ...new Map(notifications.map((item) => [item.id, item])).values(),
          ],
        });
        setLoadError(null);
      }
      return null;
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Could not load notifications";
      if (generation.current === requestGeneration) setLoadError(message);
      return message;
    } finally {
      if (generation.current === requestGeneration) setLoading(false);
    }
  }, []);

  usePageVisibilityInterval(
    () => {
      if (!mutationPending.current && !paginationPending.current)
        void refresh();
    },
    30_000,
    { runImmediately: true },
  );

  useEffect(() => {
    if (isOpen && !mutationPending.current && !paginationPending.current)
      void refresh();
  }, [isOpen, refresh]);

  const markAllRead = async () => {
    if (mutationPending.current || paginationPending.current) return;
    mutationPending.current = true;
    generation.current++;
    setMarkingRead(true);
    try {
      await api.post("/v1/core/notifications/read-all", {});
      const refreshError = await refresh();
      if (refreshError) toast.danger(refreshError);
    } catch (cause) {
      toast.danger(
        cause instanceof Error
          ? cause.message
          : "Could not mark notifications as read",
      );
    } finally {
      mutationPending.current = false;
      setMarkingRead(false);
    }
  };
  const loadMore = async () => {
    if (paginationPending.current || mutationPending.current) return;
    paginationPending.current = true;
    pageCount.current++;
    try {
      const error = await refresh();
      if (error) {
        pageCount.current--;
        toast.danger(error);
      }
    } finally {
      paginationPending.current = false;
    }
  };

  return (
    <NotificationMenu
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      unreadCount={feed.unreadCount}
      loading={loading && feed.notifications.length === 0}
      markingRead={markingRead}
      onMarkAllRead={() => void markAllRead()}
      emptyContent={
        loadError ? (
          <div className="grid justify-items-center gap-3 px-4 py-6">
            <p role="status" className="text-center text-sm text-muted">
              {loadError}
            </p>
            <Widget.Action
              isDisabled={loading || markingRead}
              onPress={() => void refresh()}
            >
              Retry
            </Widget.Action>
          </div>
        ) : undefined
      }
      footer={
        feed.nextCursor ? (
          <Widget.Action
            isDisabled={loading || markingRead}
            onPress={() => void loadMore()}
          >
            {loading ? "Loading…" : "Load more"}
          </Widget.Action>
        ) : undefined
      }
      items={feed.notifications.map((notification) => ({
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
        unread: notification.readAt === null,
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
