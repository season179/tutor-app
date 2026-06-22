export type AuthIdentity = {
  email?: string;
  userId: string;
  // The better-auth admin-plugin role (default "user" — see migrations/0012_user_role.sql).
  // Surfaced here so server fns can gate on it without a second auth round-trip.
  role: string;
};

export type RequestContext = {
  identity: AuthIdentity;
  ownerKey: string;
};

/**
 * Sessions are scoped per authenticated user. better-auth user ids are unique
 * and opaque, so they serve directly as the ownership key — no prefix needed.
 */
export function buildOwnerKey(userId: string): string {
  return userId;
}
