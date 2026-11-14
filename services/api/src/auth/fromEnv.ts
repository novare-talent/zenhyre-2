import { systemClock } from "@zenhyre/shared";
import { AuthProvider } from "./provider";
import { fakeAuth } from "./fakeAuth";
import { supabaseAuth } from "./supabaseAuth";

/**
 * Supabase Auth when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set. `AUTH_PROVIDER=fake` runs fully offline
 * (links print to the log; users live only as long as the process), which production refuses.
 */
export function authFromEnv(env: NodeJS.ProcessEnv = process.env): AuthProvider {
  if (env.AUTH_PROVIDER === "fake") {
    if (env.NODE_ENV === "production") throw new Error("AUTH_PROVIDER=fake is not allowed in production");
    console.log("auth: in-memory fake provider (offline dev). Accounts vanish when the API restarts.");
    return fakeAuth(systemClock);
  }
  const url = env.SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or AUTH_PROVIDER=fake for offline dev).");
  return supabaseAuth({ url, serviceRoleKey: key, jwtSecret: env.SUPABASE_JWT_SECRET || undefined });
}
