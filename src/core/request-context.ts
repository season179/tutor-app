export type AuthIdentity = {
  email?: string;
  userId: string;
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
