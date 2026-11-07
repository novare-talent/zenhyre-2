"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { StageLamps } from "@/components/StageLamps";
import { useNotify } from "@/components/Toasts";
import type { ApplicationView } from "@/lib/api-types";
import { dayOf, REJECTION_LABEL, STAGE_LABEL, STAGE_ORDER } from "@/lib/rules";
import { zh } from "@/lib/zh";

const STOPPED = ["rejected", "withdrawn", "offer_reneged", "declined_by_staff", "role_closed", "did_not_join", "left_early"];

export function Applications({ applications }: { applications: ApplicationView[] }) {
  const router = useRouter();
  const notify = useNotify();
  const [busy, setBusy] = useState<string | null>(null);
  const prompt = applications.find((a) => a.stage === "hired" && a.joinPromptSentAt && !a.joinConfirmedAt);
  // Open applications first, newest first within each group.
  const list = [...applications].sort((a, b) => Number(STOPPED.includes(a.stage)) - Number(STOPPED.includes(b.stage)) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

  const run = async (id: string, path: string, body: unknown, done: string) => {
    setBusy(id);
    try { await zh(path, { method: "POST", body }); notify(done); router.refresh(); }
    catch (err) { notify((err as Error).message); }
    finally { setBusy(null); }
  };

  return (
    <div className="work wrap">
      <div className="work__main">
        {prompt && (
          <div className="note post" style={{ marginBottom: "1.5rem" }}>
            <b>Did you join {prompt.company.name}{prompt.joinedOn ? ` on ${dayOf(prompt.joinedOn)}` : ""}?</b>
            <span>The company recorded your hire. Your answer confirms it, and it decides when their fee falls due.</span>
            <div className="actions" style={{ marginTop: "0.9rem" }}>
              <button type="button" className="btn btn--ink btn--sm" disabled={busy === prompt.id} onClick={() => run(prompt.id, `/me/applications/${prompt.id}/join`, { joined: true }, "Thanks. Your joining is confirmed.")}>Yes, I joined</button>
              <button type="button" className="btn btn--sm" disabled={busy === prompt.id} onClick={() => run(prompt.id, `/me/applications/${prompt.id}/join`, { joined: false }, "Noted. The company has a few days to respond.")}>No, I did not</button>
            </div>
          </div>
        )}
        <div className="work__lead">
          <h2 className="display t-m">{applications.length === 1 ? "1 application" : `${applications.length} applications`}</h2>
          <p className="meta">Open ones first.</p>
        </div>
        {applications.length === 0 ? (
          <p className="empty">You have not applied to anything yet. Roles that reach your campus are under Roles.</p>
        ) : (
          <ul className="rows">
            {list.map((a, i) => {
              const stopped = STOPPED.includes(a.stage);
              return (
                <li key={a.id} className="row post" style={{ "--i": i + 2 } as React.CSSProperties}>
                  <div style={{ padding: "1.1rem 1.25rem", display: "grid", gap: "0.8rem" }}>
                    <div className="role-row" style={{ display: "grid" }}>
                      <div>
                        <h3 className="role-row__title">{a.role.title}</h3>
                        <p className="meta" style={{ marginTop: "0.2rem" }}>{a.company.name}. {a.role.locations.join(" or ")}. {a.appliedAt ? `Applied on ${dayOf(a.appliedAt)}.` : ""}</p>
                      </div>
                      <div className="role-row__right">
                        <span className={`tag${a.stage === "hired" ? " tag--lit" : stopped ? " tag--stop" : " tag--ink"}`}>{STAGE_LABEL[a.stage]}</span>
                      </div>
                    </div>
                    {!stopped && STAGE_ORDER.includes(a.stage as (typeof STAGE_ORDER)[number]) && <StageLamps stage={a.stage} />}
                    {a.stage === "rejected" && a.rejectionCategory && <p className="small">Reason given by the company: {REJECTION_LABEL[a.rejectionCategory].toLowerCase()}. Companies share a category, not a note.</p>}
                    {a.stage === "hired" && a.joinConfirmedAt && <p className="small">Joining confirmed. Congratulations.</p>}
                    {a.stage === "hired" && !a.joinConfirmedAt && !a.joinPromptSentAt && a.joinedOn && <p className="small">You join on {dayOf(a.joinedOn)}. We will ask you to confirm on the day.</p>}
                    {a.stage === "role_closed" && <p className="small">The company closed this role.</p>}
                    {a.canWithdraw && (
                      <div className="actions">
                        <button type="button" className="btn btn--sm" disabled={busy === a.id} onClick={() => { if (confirm("Withdraw this application? This cannot be undone.")) run(a.id, `/me/applications/${a.id}/withdraw`, {}, "Application withdrawn. The company has been told."); }}>Withdraw</button>
                        {a.stage === "offer_accepted" && <span className="meta">Withdrawing after accepting an offer counts against you.</span>}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <aside className="work__side" aria-label="What the stages mean">
        <div className="sheet post" style={{ "--i": 4 } as React.CSSProperties}>
          <div className="sheet__head"><h3>What the stages mean</h3></div>
          <div className="sheet__pad">
            <ol style={{ display: "grid", gap: "0.55rem" }} className="small">
              {STAGE_ORDER.map((s, i) => <li key={s} style={{ display: "grid", gridTemplateColumns: "1.75rem 1fr" }}><span className="meta num">{String(i + 1).padStart(2, "0")}</span>{STAGE_LABEL[s]}</li>)}
            </ol>
            <p className="meta" style={{ marginTop: "1rem" }}>You get an email and a notice here when you are shortlisted, interviewed, offered or not selected. A company opening your profile does not notify you.</p>
          </div>
        </div>
      </aside>
    </div>
  );
}
