import { TowbarApiError, type TowbarUser } from "@workspace/towbar-web-client";

export function createSessionRefresh({
  load,
  onUser,
  onUnavailable,
}: {
  load: () => Promise<{ user: TowbarUser | null }>;
  onUser: (user: TowbarUser | null) => void;
  onUnavailable: () => void;
}) {
  let active = true;
  let refreshing = false;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const refresh = async () => {
    if (!active || refreshing) return;
    clearTimeout(retry);
    refreshing = true;
    try {
      const response = await load();
      if (response.user === undefined)
        throw new Error("Towbar did not return a session state");
      if (active) onUser(response.user);
    } catch (error) {
      if (!active) return;
      if (error instanceof TowbarApiError && error.status === 401) {
        onUser(null);
      } else {
        // An unreachable API cannot tell us whether the session has ended.
        onUnavailable();
        retry = setTimeout(() => void refresh(), 5_000);
      }
    } finally {
      refreshing = false;
    }
  };

  return {
    refresh,
    stop: () => {
      active = false;
      clearTimeout(retry);
    },
  };
}
