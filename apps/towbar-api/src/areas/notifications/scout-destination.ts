export function scoutDestinationDisabled(
  delivery: {
    destinationDeletedAt: Date | null;
    destinationServerId: string | null;
    destinationEnabled: boolean;
    destinationCategories: string[];
  },
  serverId: string,
) {
  return (
    Boolean(delivery.destinationDeletedAt) ||
    (delivery.destinationServerId !== null &&
      delivery.destinationServerId !== serverId) ||
    !delivery.destinationEnabled ||
    !delivery.destinationCategories.includes("scout")
  );
}
