/**
 * Where sign-in actually happens. Production uses Supabase Auth (`supabaseAuth.ts`); tests and offline dev use
 * `fakeAuth.ts`. The rest of the API only sees verified claims: `sub` is the user id Zenhyre stores as `user.id`.
 */
export interface AuthClaims { sub: string; email: string }
export interface AuthSession { accessToken: string; refreshToken: string; expiresAt: number /* unix seconds */; claims: AuthClaims }

export interface AuthProvider {
  /** A one-time sign-in token for this address, creating the auth user if it is new. Zenhyre emails it itself. */
  issueLinkToken(email: string): Promise<string>;
  /** Exchange the emailed token for a session. Throws `AuthError` if it is unknown, used or expired. */
  redeemLinkToken(token: string): Promise<AuthSession>;
  /** Swap a refresh token for a new session. Throws `AuthError` if it is no longer valid. */
  refresh(refreshToken: string): Promise<AuthSession>;
  /** Claims of a valid, unexpired access token, or null. */
  verifyAccessToken(accessToken: string): Promise<AuthClaims | null>;
  /** Revoke the session behind this access token. Best effort. */
  signOut(accessToken: string): Promise<void>;
}

export class AuthError extends Error {
  constructor(message: string) { super(message); this.name = "AuthError"; }
}
