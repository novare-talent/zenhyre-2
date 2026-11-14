import { describe, it, expect } from "vitest";
import { SignJWT } from "jose";
import { supabaseAuth } from "../src/auth/supabaseAuth";

// Offline checks of how access tokens are verified. The live exchange (generateLink, verifyOtp, refresh, and remote
// verification on a project with no signing keys) was exercised against the real project on 2026-11-14.
const url = "https://example-ref.supabase.co";
const secret = "test-legacy-jwt-secret-at-least-32-characters";
const auth = supabaseAuth({ url, serviceRoleKey: "service-role-key", jwtSecret: secret });
const sign = (claims: Record<string, unknown>, opts: { key?: string; iss?: string; exp?: string } = {}) =>
  new SignJWT({ email: "Person@Example.com", ...claims })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject("2f1d6a52-6d4c-4f3e-9d1e-1c2b3a4d5e6f").setAudience("authenticated")
    .setIssuer(opts.iss ?? `${url}/auth/v1`).setIssuedAt().setExpirationTime(opts.exp ?? "1h")
    .sign(new TextEncoder().encode(opts.key ?? secret));

describe("supabaseAuth.verifyAccessToken on a legacy HS256 project with SUPABASE_JWT_SECRET", () => {
  it("accepts a token signed with the project secret and lower-cases the email", async () => {
    expect(await auth.verifyAccessToken(await sign({}))).toEqual({ sub: "2f1d6a52-6d4c-4f3e-9d1e-1c2b3a4d5e6f", email: "person@example.com" });
  });
  it("rejects a wrong secret, another project's issuer, an expired token and garbage", async () => {
    expect(await auth.verifyAccessToken(await sign({}, { key: "some-other-secret-that-is-also-32-chars-long" }))).toBeNull();
    expect(await auth.verifyAccessToken(await sign({}, { iss: "https://other-ref.supabase.co/auth/v1" }))).toBeNull();
    expect(await auth.verifyAccessToken(await sign({}, { exp: "-1m" }))).toBeNull();
    expect(await auth.verifyAccessToken("not.a.jwt")).toBeNull();
  });
  it("rejects a token without an email claim", async () => {
    expect(await auth.verifyAccessToken(await sign({ email: undefined }))).toBeNull();
  });
});
