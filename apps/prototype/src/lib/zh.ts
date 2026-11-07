"use client";
/** Browser-side calls to the seat APIs through the same-origin proxy. Throws an Error with the API's message. */
export async function zh<T = unknown>(path: string, init: { method?: "GET" | "POST" | "PUT" | "PATCH"; body?: unknown } = {}): Promise<T> {
  const r = await fetch(`/api/zh${path}`, {
    method: init.method ?? "GET",
    headers: init.body !== undefined ? { "content-type": "application/json" } : {},
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const json = (await r.json().catch(() => ({}))) as { error?: string; message?: string; issues?: { message: string }[] };
  if (!r.ok) throw new Error(json.message ?? json.issues?.map((i) => i.message).join(", ") ?? (r.status === 401 ? "You were logged out." : "That did not go through."));
  return json as T;
}
