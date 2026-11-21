"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Board, MiniBoard } from "@/components/Board";
import { Countdown } from "@/components/Clock";
import { Arrow } from "@/components/Icons";
import { useRules } from "@/components/Rules";
import { StageLamps } from "@/components/StageLamps";
import { useNotify } from "@/components/Toasts";
import { RoleTrack } from "@/components/Track";
import type { CompanyRoleView, RolePaymentsView, ShortlistRowView } from "@/lib/api-types";
import { BillingDialog, DepositSheet, FeeLines, PaymentHistory, usePayments } from "./Payments";
import { ctcBand, dayOf, formatPaise, lpa, NEXT_STAGE, REJECTION_CATEGORIES, REJECTION_LABEL, SETTLED, STAGE_LABEL, type RejectionCategory } from "@/lib/rules";
import { zh } from "@/lib/zh";
import { useCompany } from "@/seats/company";

const lakhsToPaise = (v: string) => Math.round((Number(v) || 0) * 100_000 * 100);
const describeTerms = (t: { kind: "flat" | "percent"; amount: number }) => t.kind === "flat" ? `${formatPaise(t.amount)} flat` : `${Math.round(t.amount * 100)}% of annual CTC`;
const OPEN = ["draft", "gated", "terms_pending", "deposit_pending", "broadcast", "shortlist_ready"];

export function RolePage({ role: r, shortlist, payments = null, returned = {}, email = "" }: {
  role: CompanyRoleView | null; shortlist: ShortlistRowView[] | null; payments?: RolePaymentsView | null; returned?: { orderId?: string; pay?: string }; email?: string;
}) {
  const rules = useRules();
  const router = useRouter();
  const notify = useNotify();
  const { codes, setTitle } = useCompany();
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const title = r?.title ?? null;
  useEffect(() => { setTitle(title); return () => setTitle(null); }, [title, setTitle]);
  const pay = usePayments(r ?? ({ id: "" } as CompanyRoleView), r ? payments : null, returned);

  if (!r) {
    return (
      <div className="work wrap">
        <div className="work__main">
          <div className="empty">
            <p style={{ marginBottom: "1rem" }}>There is no role at this address, or it belongs to another company.</p>
            <Link href="/company" className="btn">Back to your roles</Link>
          </div>
        </div>
      </div>
    );
  }

  const act = async (path: string, body?: unknown, done?: string) => {
    if (busy) return;
    setBusy(true);
    try { await zh(path, { method: "POST", body }); if (done) notify(done); router.refresh(); }
    catch (err) { notify((err as Error).message); }
    finally { setBusy(false); }
  };
  const hired = r.hiredMatchId ? shortlist?.find((m) => m.id === r.hiredMatchId) ?? null : null;
  const b = payments?.balances;
  const depositState = r.depositAmount === null ? (OPEN.includes(r.status) ? "Set when you accept the terms" : "None")
    : r.status === "deposit_pending" ? "Due now" : r.depositMode === "waived" ? "Waived by Novare"
    : !b ? "" : b.depositApplied > 0 ? "Applied to the fee" : b.depositHeld > 0 ? "Held" : b.depositRefunded > 0 ? "Refunded" : b.depositForfeited > 0 ? "Forfeited" : "Settled";
  const reach = codes(r.campusReach);

  return (
    <div className="work wrap">
      <div className="work__full">
        <div className="actions" style={{ justifyContent: "space-between" }}>
          <Link href="/company" className="small link">All roles</Link>
          {OPEN.includes(r.status) && (
            <button type="button" className="btn btn--sm btn--stop" disabled={busy} onClick={() => { if (confirm("Withdraw this role? Candidates who applied are told, and the role cannot be reopened.")) act(`/roles/${r.id}/withdraw`, {}, "Role withdrawn."); }}>Withdraw the role</button>
          )}
        </div>
        <div style={{ marginTop: "1.25rem" }}><RoleTrack status={r.status} /></div>
      </div>

      <div className="work__main">
        {!shortlist && <h2 className="vh">Where this role stands</h2>}
        {r.status === "draft" && (
          <div className="note post">
            <b>Still a draft.</b>Nothing happens until it goes to the gate.
            <div className="actions" style={{ marginTop: "0.9rem" }}><button type="button" className="btn btn--ink btn--sm" disabled={busy} onClick={() => act(`/roles/${r.id}/submit`, undefined, "Submitted to the gate.")}>Submit to the gate</button></div>
          </div>
        )}
        {r.status === "gated" && (
          <div className="note post"><b>With the Novare team.</b>{r.appealed ? "Your appeal is being reviewed by a person. " : r.gate?.reason ? `${r.gate.reason} ` : "The rules passed; a person is reviewing the role. "}You will get an email with the decision{r.appealed ? ", and an appeal that is turned down is final" : ""}.</div>
        )}
        {r.status === "rejected" && (
          <div className="note note--stop post">
            <b>Not accepted at the gate{r.gate?.rule ? `. Rule: ${r.gate.rule}` : ""}.</b>
            <span>{r.gate?.reason} No candidate saw this role and nothing was charged.</span>
            {!r.appealed && (
              <div className="actions" style={{ marginTop: "0.9rem" }}>
                <button type="button" className="btn btn--sm" disabled={busy} onClick={() => act(`/roles/${r.id}/appeal`, {}, "Appeal sent to the Novare team.")}>Appeal to a person</button>
                <span className="meta">One appeal, within {rules.appealWindowDays} days.</span>
              </div>
            )}
          </div>
        )}
        {r.status === "terms_pending" && !r.feeTerms && (
          <div className="note post"><b>Accepted at the gate.</b>Novare is preparing your fee terms. They are released within {48} hours, and you will get an email.</div>
        )}
        {r.status === "terms_pending" && r.feeTerms && (
          <div className="sheet post">
            <div className="sheet__head"><h3>Fee terms for this role</h3><span className="tag tag--lit">Released</span></div>
            <div className="sheet__pad" style={{ display: "grid", gap: "1.25rem" }}>
              <p className="display t-l">{describeTerms(r.feeTerms)}, only on a hire.</p>
              <dl className="kv">
                <dt>Replacement guarantee</dt><dd>{r.feeTerms.replacement_guarantee_days} days from joining</dd>
                <dt>Invoice falls due</dt><dd>{rules.dueDaysAfterJoin} days after the candidate joins</dd>
                <dt>Campuses</dt><dd>{r.campusReach.length} of 23 <MiniBoard reach={reach} /></dd>
              </dl>
              {r.feeTerms.notes && <p className="small">{r.feeTerms.notes}</p>}
              <div className="actions">
                <button type="button" className="btn btn--ink" disabled={busy} onClick={() => act(`/roles/${r.id}/terms/accept`, undefined, "Terms accepted. They cannot change from here.")}>Accept these terms<Arrow /></button>
                <span className="meta">Terms cannot change once accepted. Unaccepted terms lapse after {rules.termsTimeoutDays} days.</span>
              </div>
            </div>
          </div>
        )}
        {r.status === "deposit_pending" && <DepositSheet payments={payments} ctl={pay} broadcastDays={rules.broadcastDays} />}
        {r.status === "broadcast" && (
          <div style={{ display: "grid", gap: "1.5rem" }}>
            <div className="note post">
              <b>{r.broadcastClosesAt ? <Countdown until={r.broadcastClosesAt} prefix="On the board. Closes in" done="The window has closed; the shortlist is being frozen." /> : "On the board."}</b>
              {r.applicants} {r.applicants === 1 ? "applicant" : "applicants"} so far. The shortlist stays hidden until the window closes, so the ranking cannot be second-guessed while it is still moving.
            </div>
            <div className="post" style={{ "--i": 2 } as React.CSSProperties}>
              <Board selected={new Set(reach)} compact label={`Campuses this role reaches: ${reach.length} of 23`} />
            </div>
          </div>
        )}
        {r.status === "withdrawn" && <div className="note post"><b>Withdrawn.</b>This role is closed for good. Post a new one if you still need to hire.</div>}
        {shortlist && (
          <>
            <div className="work__lead">
              <h2 className="display t-m">The shortlist, ranked by fit</h2>
              <p className="meta">{shortlist.length === 0 ? "Nobody applied before the window closed." : "Frozen when the window closed. Open a row to act on it."}</p>
            </div>
            {shortlist.length > 0 && (
              <div className="post" style={{ "--i": 2 } as React.CSSProperties}>
                <table className="slist">
                  <caption className="vh">Shortlisted candidates in rank order</caption>
                  <thead><tr><th scope="col">Rank</th><th scope="col">Candidate</th><th scope="col" className="hide-s">Campus</th><th scope="col" className="hide-s">Stage</th><th scope="col" style={{ textAlign: "right" }}>Fit</th></tr></thead>
                  <tbody>
                    {shortlist.map((m, i) => {
                      const settled = SETTLED.includes(m.stage) && m.stage !== "hired";
                      const tag = <span className={`tag${m.stage === "hired" ? " tag--lit" : settled ? " tag--quiet" : m.stage === "shortlisted" ? "" : " tag--ink"}`}>{m.stage === "shortlisted" ? "New" : STAGE_LABEL[m.stage]}</span>;
                      const name = m.candidate?.name || `Candidate ${String(i + 1).padStart(2, "0")}`;
                      return (
                        <tr key={m.id} className={`srow${settled ? " is-settled" : ""}${m.stage === "hired" ? " is-hired" : ""}`}>
                          <td className="c srow__rank num">{String(m.rank ?? i + 1).padStart(2, "0")}</td>
                          <td className="c">
                            <button type="button" className="srow__name" onClick={() => setOpenId(m.id)} aria-haspopup="dialog">{name}</button>
                            <span className="meta" style={{ display: "block" }}>{m.candidate ? m.candidate.profile.headline || [m.candidate.profile.currentTitle, m.candidate.profile.currentCompany].filter(Boolean).join(", ") || m.candidate.course : ""}</span>
                            <span className="srow__stage-s">{tag}</span>
                          </td>
                          <td className="c hide-s"><span style={{ fontWeight: 600 }}>{m.candidate?.campus?.name ?? ""}</span><span className="meta" style={{ display: "block" }}>{m.candidate ? `${m.candidate.gradDate.slice(0, 4)}, ${m.candidate.profile.yearsExperience ?? 0} yrs` : ""}</span></td>
                          <td className="c hide-s">{tag}</td>
                          <td className="c srow__fit num">{m.fitScore}</td>
                        </tr>
                      );
                    })}
                    <tr className="cutline"><td colSpan={5}><div className="cutline__in"><span>The line. Up to {r.shortlistCap} fit above it.</span><span>{Math.max(0, r.applicants - shortlist.length)} more applied. Novare keeps the longlist.</span></div></td></tr>
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      <aside className="work__side" aria-label="Role facts">
        {hired && (
          <div className="sheet post">
            <div className="sheet__head"><h3>Hire and fee</h3><span className="tag tag--lit">Hire recorded</span></div>
            <div className="sheet__pad">
              <p style={{ fontWeight: 700 }}>{hired.candidate?.name || "Hired candidate"}</p>
              <p className="meta" style={{ marginBottom: "1rem" }}>Joins {dayOf(hired.joinedOn!)} at {lpa(hired.hiredCtc!)}{r.feeTerms ? `. Fee: ${describeTerms(r.feeTerms)}` : ""}</p>
              {payments ? <FeeLines payments={payments} ctl={pay} /> : <p className="meta">The fee details could not be loaded.</p>}
              <p className="meta" style={{ margin: "1rem 0" }}>{r.feeTerms ? `The ${r.feeTerms.replacement_guarantee_days}-day replacement guarantee runs to ${dayOf(hired.joinedOn!, r.feeTerms.replacement_guarantee_days)}. ` : ""}{hired.joinConfirmedAt ? "Joining is confirmed." : "We ask the candidate to confirm joining on the day."}</p>
              {!hired.joinConfirmedAt
                ? <button type="button" className="btn btn--sm btn--stop" disabled={busy} onClick={() => act(`/matches/${hired.id}/actions`, { stage: "did_not_join" }, "Noted. The fee is voided, the deposit is held again and the shortlist is open.")}>Candidate did not join</button>
                : r.status === "closing" && <button type="button" className="btn btn--sm btn--stop" disabled={busy} onClick={() => { if (confirm("Record that the candidate left inside the guarantee? A replacement search starts at no extra fee.")) act(`/matches/${hired.id}/actions`, { stage: "left_early" }, "Replacement search started."); }}>Candidate left early</button>}
            </div>
          </div>
        )}
        {payments && <PaymentHistory roleId={r.id} payments={payments} />}
        <div className="sheet post" style={{ "--i": 3 } as React.CSSProperties}>
          <div className="sheet__head"><h3>This role</h3><span className="meta">Posted {dayOf(r.createdAt)}</span></div>
          <div className="sheet__pad">
            <dl className="kv">
              <dt>For</dt><dd>{r.type === "intern" ? "Interns" : r.type === "fresher" ? "Freshers" : `${r.yearsExpMin} to ${r.yearsExpMax} years`}</dd>
              <dt>Pay</dt><dd>{ctcBand(r.type, r.ctcMin, r.ctcMax)}</dd>
              <dt>Where</dt><dd>{r.locations.join(", ") || "Not set"}</dd>
              <dt>Reach</dt><dd>{r.campusReach.length} of 23 <MiniBoard reach={reach} /></dd>
              <dt>Deposit</dt><dd className="num">{r.depositAmount !== null ? `${formatPaise(r.depositAmount)} + GST. ` : ""}{depositState}</dd>
              {r.feeTerms && <><dt>Fee on a hire</dt><dd>{describeTerms(r.feeTerms)}</dd></>}
              {r.gate && r.status !== "rejected" && <><dt>Gate</dt><dd style={{ fontWeight: 400 }}>{r.gate.outcome === "accept" ? `Accepted (${r.gate.stage === "human" ? "by a person" : "at the " + r.gate.stage + " pass"}).` : r.gate.reason}</dd></>}
            </dl>
          </div>
        </div>
      </aside>

      <BillingDialog ctl={pay} initial={payments?.billing ?? null} defaultEmail={email} />
      <CandidatePanel role={r} match={shortlist?.find((m) => m.id === openId) ?? null} onClose={() => setOpenId(null)} act={act} busy={busy} />
    </div>
  );
}

/** One shortlisted candidate. Actions follow the §4.3 transition table; the API enforces it. */
function CandidatePanel({ role, match, onClose, act, busy }: { role: CompanyRoleView; match: ShortlistRowView | null; onClose: () => void; act: (p: string, b?: unknown, d?: string) => Promise<void>; busy: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [offer, setOffer] = useState("");
  const [ctc, setCtc] = useState("");
  const [joined, setJoined] = useState("");
  const [category, setCategory] = useState<RejectionCategory | "">("");
  const id = match?.id;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (id && !d.open) {
      d.showModal(); setOffer(""); setCtc(""); setJoined(""); setCategory("");
      if (match?.stage === "shortlisted" && !role.hiredMatchId) void act(`/matches/${id}/actions`, { stage: "viewed" }); // opening the profile is the "viewed" step
    }
    if (!id && d.open) d.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const m = match;
  const next = m ? NEXT_STAGE[m.stage] : undefined;
  const settled = m ? SETTLED.includes(m.stage) : true;
  const locked = !!role.hiredMatchId && m?.stage !== "hired"; // one-hire rule
  const p = m?.candidate?.profile;
  return (
    <dialog ref={ref} className="panel" aria-labelledby="panel-h" onClose={onClose} onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}>
      {m && (
        <>
          <div className="panel__head">
            <span className="meta">{m.rank ? `Rank ${String(m.rank).padStart(2, "0")} of ${role.shortlistCap}` : STAGE_LABEL[m.stage]}</span>
            <button type="button" className="btn btn--sm" onClick={() => ref.current?.close()}>Close</button>
          </div>
          <div className="panel__body">
            <div>
              <h2 id="panel-h" className="display t-l">{m.candidate?.name || "Candidate"}</h2>
              <p className="meta" style={{ marginTop: "0.5rem" }}>{[p?.headline || [p?.currentTitle, p?.currentCompany].filter(Boolean).join(", "), p?.preferredLocations?.length ? `Wants ${p.preferredLocations.join(" or ")}` : ""].filter(Boolean).map((s) => s!.replace(/[.\s]+$/, "") + ".").join(" ")}</p>
            </div>
            <div className="panel__fit">
              <b className="num">{m.fitScore}</b>
              <p className="small"><span style={{ fontWeight: 700, display: "block" }}>Why this rank</span>{m.fitReason || "Scored on skills, seniority, domain and location."}</p>
            </div>
            <dl className="kv">
              <dt>Campus</dt><dd>{m.candidate?.campus?.name ?? ""}</dd>
              <dt>Degree</dt><dd>{m.candidate?.course}, {m.candidate?.gradDate.slice(0, 4)}</dd>
              <dt>Experience</dt><dd>{p?.yearsExperience ?? 0} years</dd>
              <dt>Notice period</dt><dd>{p?.noticePeriodDays ?? 0} days</dd>
              {p?.linkedinUrl ? <><dt>LinkedIn</dt><dd><a className="link" href={p.linkedinUrl} target="_blank" rel="noreferrer">Profile</a></dd></> : null}
              {m.offeredCtc ? <><dt>Offered</dt><dd>{lpa(m.offeredCtc)}</dd></> : null}
            </dl>
            {p?.skills.length ? <div className="chips">{p.skills.map((s) => <span key={s} className="tag tag--quiet">{s}</span>)}</div> : null}
            <div>
              <p className="small" style={{ fontWeight: 700, marginBottom: "0.5rem" }}>{STAGE_LABEL[m.stage]}{m.stage === "rejected" && m.rejectionCategory ? `: ${REJECTION_LABEL[m.rejectionCategory].toLowerCase()}` : ""}</p>
              {!settled || m.stage === "hired" ? <StageLamps stage={m.stage} /> : null}
            </div>

            {locked && !settled && <p className="note">A hire is already recorded on this role. Other candidates can only be marked not selected.</p>}

            {!settled && !locked && next === "interviewed" && (
              <button type="button" className="btn btn--ink" disabled={busy} onClick={() => act(`/matches/${m.id}/actions`, { stage: "interviewed" }, "Interview recorded. The candidate has been told.")}>Record an interview<Arrow /></button>
            )}
            {!settled && !locked && next === "offered" && (
              <form className="field" onSubmit={(e) => { e.preventDefault(); act(`/matches/${m.id}/actions`, { stage: "offered", offeredCtc: lakhsToPaise(offer) }, "Offer recorded. The candidate has been told."); }}>
                <label htmlFor="offer">Offer, lakhs a year</label>
                <div className="linkbox">
                  <input id="offer" className="input" style={{ border: 0 }} inputMode="decimal" required value={offer} onChange={(e) => setOffer(e.target.value.replace(/[^\d.]/g, ""))} />
                  <button type="submit" className="btn btn--ink" disabled={busy}>Record the offer</button>
                </div>
              </form>
            )}
            {!settled && !locked && next === "offer_accepted" && (
              <button type="button" className="btn btn--ink" disabled={busy} onClick={() => act(`/matches/${m.id}/actions`, { stage: "offer_accepted" }, "Offer marked accepted.")}>Mark the offer accepted<Arrow /></button>
            )}
            {!settled && !locked && next === "hired" && (
              <form className="form" onSubmit={(e) => { e.preventDefault(); act(`/matches/${m.id}/actions`, { stage: "hired", hiredCtc: lakhsToPaise(ctc), joinedOn: joined }, "Hire recorded. We will confirm joining with the candidate."); }}>
                <div className="form__pair">
                  <div className="field">
                    <label htmlFor="hctc">Final CTC, lakhs a year</label>
                    <input id="hctc" className="input" inputMode="decimal" required value={ctc} onChange={(e) => setCtc(e.target.value.replace(/[^\d.]/g, ""))} />
                  </div>
                  <div className="field">
                    <label htmlFor="join">Joining date</label>
                    <input id="join" className="input" type="date" required value={joined} onChange={(e) => setJoined(e.target.value)} />
                  </div>
                </div>
                <div className="actions">
                  <button type="submit" className="btn btn--ink" disabled={busy}>Record the hire<Arrow /></button>
                  <button type="button" className="btn btn--sm" disabled={busy} onClick={() => act(`/matches/${m.id}/actions`, { stage: "offer_reneged" }, "Noted: the candidate backed out.")}>Candidate backed out</button>
                </div>
                <p className="meta">Recording a hire raises the success fee plus GST and applies your deposit to it. One hire per role.</p>
              </form>
            )}

            {!settled && (
              <form className="field" style={{ borderTop: "1px solid var(--rule)", paddingTop: "1.25rem" }} onSubmit={(e) => { e.preventDefault(); if (category) act(`/matches/${m.id}/actions`, { stage: "rejected", rejectionCategory: category }, "Marked not selected. The candidate sees the category only."); }}>
                <label htmlFor="why">Not selecting them</label>
                <div className="linkbox">
                  <select id="why" className="select" style={{ border: 0 }} required value={category} onChange={(e) => setCategory(e.target.value as RejectionCategory)}>
                    <option value="">Choose a reason</option>
                    {REJECTION_CATEGORIES.map((c) => <option key={c} value={c}>{REJECTION_LABEL[c]}</option>)}
                  </select>
                  <button type="submit" className="btn btn--stop" disabled={busy}>Mark not selected</button>
                </div>
                <span className="hint">The candidate sees the reason category and nothing else.</span>
              </form>
            )}
            {m.stage === "hired" && <p className="note"><b>Hired.</b>The fee and the joining confirmation are on the role page.</p>}
          </div>
        </>
      )}
    </dialog>
  );
}
