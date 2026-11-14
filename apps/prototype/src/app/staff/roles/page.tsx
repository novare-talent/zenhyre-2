import type { Metadata } from "next";
import { requireStaffSession } from "../guard";
import Link from "next/link";
import { readApi } from "@/lib/server-api";

export const metadata: Metadata = { title: "Roles" };
const STATUSES = ["draft", "gated", "rejected", "terms_pending", "deposit_pending", "broadcast", "shortlist_ready", "closing", "closed", "withdrawn"] as const;
interface Row { id: string; title: string; status: string; type: string; companyId: string; applicants: number; createdAt: string; jobError: string | null; broadcastClosesAt: string | null }

export default async function Page({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireStaffSession();
  const { status } = await searchParams;
  const valid = STATUSES.find((s) => s === status);
  const { roles } = await readApi<{ roles: Row[] }>(`/admin/roles${valid ? `?status=${valid}` : ""}`);
  roles.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <div className="work wrap">
      <div className="work__main">
        <nav className="chips" aria-label="Filter by status" style={{ marginBottom: "1.25rem" }}>
          <Link href="/staff/roles" className={`tag${!valid ? " tag--lit" : ""}`}>All</Link>
          {STATUSES.map((s) => <Link key={s} href={`/staff/roles?status=${s}`} className={`tag${valid === s ? " tag--lit" : ""}`}>{s.replace(/_/g, " ")}</Link>)}
        </nav>
        {roles.length === 0 ? <p className="empty">No roles{valid ? ` in ${valid.replace(/_/g, " ")}` : ""}.</p> : (
          <ul className="rows">
            {roles.map((r) => (
              <li key={r.id} className="row">
                <Link href={`/staff/roles/${r.id}`} className="row__hit role-row">
                  <span>
                    <span className="role-row__title">{r.title}</span>
                    <span className="meta" style={{ display: "block" }}>{r.type} · {r.applicants} applicant{r.applicants === 1 ? "" : "s"}{r.broadcastClosesAt && r.status === "broadcast" ? ` · closes ${new Date(r.broadcastClosesAt).toLocaleDateString("en-IN")}` : ""}</span>
                  </span>
                  <span className="chips" style={{ justifyContent: "flex-end" }}>
                    {r.jobError && <span className="tag tag--stop">job error</span>}
                    <span className="tag">{r.status.replace(/_/g, " ")}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
