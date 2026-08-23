export function instrumentTemporalActivities<
  TActivities extends Record<string, unknown>,
>(activities: TActivities): TActivities {
  return activities;
}
