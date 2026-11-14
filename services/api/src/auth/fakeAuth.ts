import { randomBytes, randomUUID } from "node:crypto";
import { Clock, systemClock } from "@zenhyre/shared";
import { AuthClaims, AuthError, AuthProvider, AuthSession } from "./provider";

const LINK_TTL_MS = 15 * 60 * 1000;
const ACCESS_TTL_MS = 60 * 60 * 1000;

/**
 * An in-memory stand-in for Supabase Auth with the same rules: single-use 15-minute links, one-hour access tokens,
 * rotating refresh tokens, and a stable user id per address. Used by the tests and by `AUTH_PROVIDER=fake` in dev.
 */
export function fakeAuth(clock: Clock = systemClock, opts: { accessTtlMs?: number } = {}): AuthProvider & { userIdFor(email: string): string | undefined } {
  const accessTtl = opts.accessTtlMs ?? ACCESS_TTL_MS;
  const users = new Map<string, string>(); // email -> id
  const links = new Map<string, { email: string; expiresAt: number }>();
  const access = new Map<string, { claims: AuthClaims; expiresAt: number }>();
  const refresh = new Map<string, AuthClaims>();
  const tok = () => randomBytes(24).toString("base64url");
  const now = () => clock.now().getTime();

  function open(claims: AuthClaims): AuthSession {
    const accessToken = "fake." + tok();
    const refreshToken = tok();
    const expiresAt = now() + accessTtl;
    access.set(accessToken, { claims, expiresAt });
    refresh.set(refreshToken, claims);
    return { accessToken, refreshToken, expiresAt: Math.floor(expiresAt / 1000), claims };
  }
  return {
    userIdFor: (email) => users.get(email.toLowerCase()),
    async issueLinkToken(email) {
      const e = email.toLowerCase();
      if (!users.has(e)) users.set(e, randomUUID());
      const t = tok();
      links.set(t, { email: e, expiresAt: now() + LINK_TTL_MS });
      return t;
    },
    async redeemLinkToken(token) {
      const l = links.get(token);
      if (!l) throw new AuthError("unknown or used link");
      links.delete(token);
      if (l.expiresAt < now()) throw new AuthError("link expired");
      return open({ sub: users.get(l.email)!, email: l.email });
    },
    async refresh(refreshToken) {
      const c = refresh.get(refreshToken);
      if (!c) throw new AuthError("invalid refresh token");
      refresh.delete(refreshToken);
      return open(c);
    },
    async verifyAccessToken(accessToken) {
      const a = access.get(accessToken);
      return a && a.expiresAt > now() ? a.claims : null;
    },
    async signOut(accessToken) {
      const a = access.get(accessToken);
      access.delete(accessToken);
      if (a) for (const [r, c] of refresh) if (c.sub === a.claims.sub) refresh.delete(r);
    },
  };
}
