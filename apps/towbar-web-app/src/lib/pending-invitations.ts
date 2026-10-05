export function getPendingInvitations<
  T extends { status: string; expiresAt: string },
>(invitations: readonly T[], now: number) {
  return invitations.filter(
    (invitation) =>
      invitation.status === "pending" && Date.parse(invitation.expiresAt) > now,
  );
}
