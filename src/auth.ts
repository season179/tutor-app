import { betterAuth } from "better-auth";
import { anonymous } from "better-auth/plugins";

/**
 * Environment required to build a better-auth instance at runtime. The Worker
 * supplies the real D1 binding; the string fields come from wrangler
 * vars/secrets (see wrangler.jsonc).
 */
export type AuthEnv = {
  /** D1 binding. */
  DB: unknown;
  /** Base URL of the deployed app, e.g. https://ai-tutor.example.dev. */
  BETTER_AUTH_URL?: string;
  /** Secret used to sign session cookies. */
  BETTER_AUTH_SECRET: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
};

export type TransferSessions = (fromUserId: string, toUserId: string) => Promise<void>;

export type CreateAuthOptions = {
  transferSessions?: TransferSessions;
};

/**
 * Prefix for better-auth's own routes (sign-in, callback, sign-out, get-session).
 * Routed to {@link Auth.handler} before the ownership-gated API handler.
 */
export const authPathPrefix = "/api/auth/";

export async function transferSessionsOnLink(
  transferSessions: TransferSessions,
  anonymousUserId: string,
  newUserId: string
): Promise<void> {
  await transferSessions(anonymousUserId, newUserId);
}

export function createAuth(env: AuthEnv, options: CreateAuthOptions = {}) {
  const { transferSessions } = options;

  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    // better-auth (1.5+) accepts a D1Database binding natively. AuthEnv keeps DB
    // as `unknown` so this module avoids importing Cloudflare runtime types; the
    // cast preserves that boundary.
    database: env.DB as Parameters<typeof betterAuth>[0]["database"],
    plugins: [
      anonymous({
        onLinkAccount: async ({ anonymousUser, newUser }) => {
          if (!transferSessions) {
            return;
          }

          try {
            await transferSessionsOnLink(
              transferSessions,
              anonymousUser.user.id,
              newUser.user.id
            );
          } catch (error) {
            console.error("Failed to transfer sessions during account link", error);
            throw error;
          }
        }
      })
    ],
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID ?? "",
        clientSecret: env.GOOGLE_CLIENT_SECRET ?? ""
      }
    }
  });
}

export type Auth = ReturnType<typeof createAuth>;
