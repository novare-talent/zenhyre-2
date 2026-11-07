// Server components read the seat APIs directly with the session cookie. A 401 means the session is gone.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { apiFetch, COOKIE } from "./session";

export async function readApi<T>(path: string): Promise<T> {
  const sid = (await cookies()).get(COOKIE.session)?.value;
  if (!sid) redirect("/login");
  let r: Response;
  try { r = await apiFetch(path, { session: sid }); } catch { throw new Error("api_unreachable"); }
  if (r.status === 401) redirect("/auth/expired");
  if (!r.ok) throw new Error(`api ${r.status} for ${path}`);
  return (await r.json()) as T;
}
/** Like readApi, but a 404 or 409 answers null instead of throwing (a shortlist that is not ready yet, a role that is not yours). */
export async function readApiOrNull<T>(path: string): Promise<T | null> {
  const sid = (await cookies()).get(COOKIE.session)?.value;
  if (!sid) redirect("/login");
  let r: Response;
  try { r = await apiFetch(path, { session: sid }); } catch { throw new Error("api_unreachable"); }
  if (r.status === 401) redirect("/auth/expired");
  if (r.status === 404 || r.status === 409 || r.status === 403) return null;
  if (!r.ok) throw new Error(`api ${r.status} for ${path}`);
  return (await r.json()) as T;
}
