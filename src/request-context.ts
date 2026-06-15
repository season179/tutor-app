export type AccessIdentity = {
  email?: string;
  sub: string;
};

export type RequestContext = {
  identity: AccessIdentity;
  ownerKey: string;
};

export function buildOwnerKey(sub: string): string {
  return `access:${sub}`;
}
