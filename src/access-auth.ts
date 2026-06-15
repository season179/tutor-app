import { createRemoteJWKSet, jwtVerify } from "jose";

import { HttpError } from "./http-error.js";
import { buildOwnerKey, type AccessIdentity, type RequestContext } from "./request-context.js";

export const accessJwtHeader = "cf-access-jwt-assertion";

export type AccessAuthEnv = {
  ACCESS_DEV_IDENTITY?: string;
  POLICY_AUD?: string;
  TEAM_DOMAIN?: string;
};

export type AuthenticateRequestOptions = {
  allowDevBypass?: boolean;
};

export function parseDevIdentity(value: string | undefined): AccessIdentity | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value) as { email?: unknown; sub?: unknown };

    if (typeof parsed.sub !== "string" || !parsed.sub.trim()) {
      return undefined;
    }

    return {
      sub: parsed.sub.trim(),
      ...(typeof parsed.email === "string" && parsed.email ? { email: parsed.email } : {})
    };
  } catch {
    return undefined;
  }
}

function normalizeTeamDomain(teamDomain: string): string {
  return teamDomain.startsWith("https://") ? teamDomain : `https://${teamDomain}`;
}

export async function verifyAccessJwt(
  token: string,
  env: Pick<AccessAuthEnv, "POLICY_AUD" | "TEAM_DOMAIN">
): Promise<AccessIdentity> {
  const teamDomain = env.TEAM_DOMAIN?.trim();
  const policyAud = env.POLICY_AUD?.trim();

  if (!teamDomain || !policyAud) {
    throw new HttpError(403, "Unauthorized");
  }

  const issuer = normalizeTeamDomain(teamDomain);
  const jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));

  try {
    const { payload } = await jwtVerify(token, jwks, {
      audience: policyAud,
      issuer
    });

    const sub = typeof payload.sub === "string" ? payload.sub.trim() : "";
    if (!sub) {
      throw new HttpError(403, "Unauthorized");
    }

    const email = typeof payload.email === "string" && payload.email ? payload.email : undefined;

    return {
      sub,
      ...(email ? { email } : {})
    };
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }

    throw new HttpError(403, "Unauthorized");
  }
}

export async function authenticateRequest(
  request: Request,
  env: AccessAuthEnv,
  options: AuthenticateRequestOptions = {}
): Promise<RequestContext> {
  const token = request.headers.get(accessJwtHeader);

  if (token) {
    const identity = await verifyAccessJwt(token, env);
    return {
      identity,
      ownerKey: buildOwnerKey(identity.sub)
    };
  }

  if (options.allowDevBypass) {
    const identity = parseDevIdentity(env.ACCESS_DEV_IDENTITY);
    if (identity) {
      return {
        identity,
        ownerKey: buildOwnerKey(identity.sub)
      };
    }
  }

  throw new HttpError(403, "Unauthorized");
}
