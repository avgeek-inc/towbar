"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { RuntimeCapacity } from "@workspace/towbar-web-client";
import { useApiQuery } from "@/hooks/use-api-query";

const CapacityContext = createContext<ReadonlyMap<string, RuntimeCapacity>>(
  new Map(),
);

/** One subscription per server, shared by every CPU and memory cell. */
export function InventoryRuntimeCapacity({
  serverIds,
  children,
}: {
  serverIds: string[];
  children: ReactNode;
}) {
  const [capacities, setCapacities] = useState<
    ReadonlyMap<string, RuntimeCapacity>
  >(new Map());
  const updateCapacity = useCallback(
    (serverId: string, capacity: RuntimeCapacity | undefined) => {
      setCapacities((current) => {
        if (current.get(serverId) === capacity) return current;
        const next = new Map(current);
        if (capacity) next.set(serverId, capacity);
        else next.delete(serverId);
        return next;
      });
    },
    [],
  );
  return (
    <CapacityContext.Provider value={capacities}>
      {serverIds.map((serverId) => (
        <ServerCapacitySubscription
          key={serverId}
          serverId={serverId}
          onCapacity={updateCapacity}
        />
      ))}
      {children}
    </CapacityContext.Provider>
  );
}

function ServerCapacitySubscription({
  serverId,
  onCapacity,
}: {
  serverId: string;
  onCapacity: (serverId: string, capacity: RuntimeCapacity | undefined) => void;
}) {
  const query = useApiQuery<{ capacity: RuntimeCapacity }>(
    `/v1/core/servers/${serverId}/capacity`,
    5_000,
  );
  useEffect(() => {
    onCapacity(serverId, query.error ? undefined : query.data?.capacity);
  }, [onCapacity, serverId, query.data, query.error]);
  useEffect(
    () => () => onCapacity(serverId, undefined),
    [onCapacity, serverId],
  );
  return null;
}

export function useInventoryRuntimeCapacity() {
  const capacities = useContext(CapacityContext);
  return new Map(
    Array.from(capacities.values()).flatMap((capacity) =>
      capacity.runtimes.map((runtime) => [runtime.id, runtime] as const),
    ),
  );
}
