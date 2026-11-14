import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload } from "jose";
import { AuthClaims, AuthError, AuthProvider, AuthSession } from "./provider";

export interface SupabaseAuthConfig {
  url: string;
  /** Server-only. Needed to mint sign-in links for addresses that have no account yet and to revoke sessions. */
  serviceRoleKey: string;
  /** Legacy HS256 projects: the project's JWT secret. Projects on asymmetric signing keys leave this unset (JWKS is used). */
  jwtSecret?: string;
}

/**
 * Supabase Auth behind Zenhyre's AuthProvider. Zenhyre sends its own emails (Resend, 2.0 templates), so this never
 * asks Supabase to send mail and does not depend on the project's email templates or redirect URLs, which 1.0 shares.
 */
export function supabaseAuth(cfg: SupabaseAuthConfig): AuthProvider {
  const base = cfg.url.replace(/\/$/, "");
  const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } } as const;
  const admin = createClient(base, cfg.serviceRoleKey, opts);
  // A fresh client per exchange so no session state is shared between requests.
  const client = (): SupabaseClient => createClient(base, cfg.serviceRoleKey, opts);
  const issuer = `${base}/auth/v1`;
  const secret = cfg.jwtSecret ? new TextEncoder().encode(cfg.jwtSecret) : null;
  const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));

  // Fallback verification through Supabase (GET /auth/v1/user), cached briefly so a page's several API calls cost one.
  const verified = new Map<string, { claims: AuthClaims | null; until: number }>();
  async function remoteVerify(token: string): Promise<AuthClaims | null> {
    const hit = verified.get(token);
    if (hit && hit.until > Date.now()) return hit.claims;
    const { data, error } = await admin.auth.getUser(token);
    const claims = !error && data.user?.email ? { sub: data.user.id, email: data.user.email.toLowerCase() } : null;
    if (verified.size > 10_000) verified.clear();
    verified.set(token, { claims, until: Date.now() + 60_000 });
    return claims;
  }

  const toSession = (s: Session | null): AuthSession => {
    if (!s?.access_token || !s.refresh_token || !s.user?.email) throw new AuthError("no session returned");
    return { accessToken: s.access_token, refreshToken: s.refresh_token, expiresAt: s.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
      claims: { sub: s.user.id, email: s.user.email.toLowerCase() } };
  };
  const claimsOf = (p: JWTPayload): AuthClaims | null =>
    typeof p.sub === "string" && typeof p.email === "string" && p.email ? { sub: p.sub, email: p.email.toLowerCase() } : null;

  return {
    async issueLinkToken(email) {
      const e = email.toLowerCase();
      let r = await admin.auth.admin.generateLink({ type: "magiclink", email: e });
      if (r.error) {
        // Older Auth versions only issue magic links for existing users: create the user, then ask again.
        const created = await admin.auth.admin.createUser({ email: e });
        if (created.error && !/already/i.test(created.error.message)) throw created.error;
        r = await admin.auth.admin.generateLink({ type: "magiclink", email: e });
        if (r.error) throw r.error;
      }
      const hashed = r.data.properties?.hashed_token;
      if (!hashed) throw new Error("supabase returned no link token");
      return hashed;
    },
    async redeemLinkToken(token) {
      const { data, error } = await client().auth.verifyOtp({ token_hash: token, type: "email" });
      if (error) throw new AuthError(error.message);
      return toSession(data.session);
    },
    async refresh(refreshToken) {
      const { data, error } = await client().auth.refreshSession({ refresh_token: refreshToken });
      if (error) throw new AuthError(error.message);
      return toSession(data.session);
    },
    async verifyAccessToken(accessToken) {
      let alg: string | undefined;
      try { alg = decodeProtectedHeader(accessToken).alg; } catch { return null; }
      try {
        if (alg?.startsWith("HS")) {
          // Legacy shared-secret project: verify locally when the secret is configured, otherwise ask Supabase.
          if (!secret) return await remoteVerify(accessToken);
          return claimsOf((await jwtVerify(accessToken, secret, { audience: "authenticated", issuer, algorithms: [alg] })).payload);
        }
        return claimsOf((await jwtVerify(accessToken, jwks, { audience: "authenticated", issuer })).payload);
      } catch {
        return null;
      }
    },
    async signOut(accessToken) {
      await admin.auth.admin.signOut(accessToken).catch(() => {});
    },
  };
}
