"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Board, MiniBoard } from "@/components/Board";
import { Countdown } from "@/components/Clock";
import { Arrow } from "@/components/Icons";
import { useRules } from "@/components/Rules";
import { RoleTrack } from "@/components/Track";
import { campus } from "@/data/campuses";
import { BELOW_LINE } from "@/data/fixtures";
import { ctcBand, describeTerms, formatPaise, lpa, NEXT_STAGE, REJECTION_CATEGORIES, REJECTION_LABEL, SETTLED, STAGE_LABEL, type RejectionCategory } from "@/lib/rules";
import { feeBreakdown, useCompany, type MatchRow } from "@/seats/company";
import { StageLamps } from "@/components/StageLamps";

const fmtDate = (iso: string, addDays = 0) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + addDays);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(d);
};
const lakhsToPaise = (v: string) => Math.round((Number(v) || 0) * 100_000 * 100);

export function RolePage({ id }: { id: string }) {
  const rules = useRules();
  const { role, depositOf, acceptTerms, payDeposit, appeal, matches, hire, didNotJoin } = useCompany();
  const [openId, setOpenId] = useState<string | null>(null);
  const r = role(id);

  if (!r) {
    return (
      <div className="work wrap">
        <div className="work__main">
          <div className="empty">
            <p style={{ marginBottom: "1rem" }}>This role is not in the session. Roles posted in the prototype are kept in memory and are gone after a reload.</p>
            <Link href="/company" className="btn">Back to your roles</Link>
          </div>
        </div>
      </div>
    );
  }
  const deposit = depositOf(r);
  const hasShortlist = r.id === "founding-backend" && (r.status === "shortlist_ready" || r.status === "closing");
  const fee = hire && r.id === "founding-backend" ? feeBreakdown(r, deposit, hire) : null;
  const hired = hire ? matches.find((m) => m.id === hire.matchId) : undefined;
  const depositState = r.status === "rejected" || r.status === "gated" || r.status === "terms_pending" ? "Not due yet"
    : r.status === "deposit_pending" ? "Due now" : fee ? "Applied to the fee" : "Held";

  return (
    <div className="work wrap">
      <div className="work__full">
        <Link href="/company" className="small link">All roles</Link>
        <div style={{ marginTop: "1.25rem" }}><RoleTrack status={r.status} /></div>
      </div>

      <div className="work__main">
        {!hasShortlist && <h2 className="vh">Where this role stands</h2>}
        {r.status === "rejected" && (
          <div className="note note--stop post">
            <b>Not accepted at the gate. Rule: {r.gateRule}.</b>
            <span>{r.gateNote} No candidate saw this role and nothing was charged.</span>
            <div className="actions" style={{ marginTop: "0.9rem" }}>
              <button type="button" className="btn btn--sm" onClick={() => appeal(r.id)}>Appeal to a person</button>
              <span className="meta">One appeal, within {rules.appealWindowDays} days.</span>
            </div>
          </div>
        )}
        {r.status === "gated" && (
          <div className="note post"><b>With the Novare team.</b>{r.gateNote} You will get an email with the decision. An appeal that is turned down is final.</div>
        )}
        {r.status === "terms_pending" && r.terms && (
          <div className="sheet post">
            <div className="sheet__head"><h3>Fee terms for this role</h3><span className="tag tag--lit">Released</span></div>
            <div className="sheet__pad" style={{ display: "grid", gap: "1.25rem" }}>
              <p className="display t-l">{describeTerms(r.terms)}, only on a hire.</p>
              <dl className="kv">
                <dt>Replacement guarantee</dt><dd>{r.terms.replacementGuaranteeDays} days from joining</dd>
                <dt>Invoice falls due</dt><dd>{rules.dueDaysAfterJoin} days after the candidate joins</dd>
                <dt>Deposit to go on the board</dt><dd className="num">{formatPaise(deposit)}, refundable</dd>
              </dl>
              <div className="actions">
                <button type="button" className="btn btn--ink" onClick={() => acceptTerms(r.id)}>Accept these terms<Arrow /></button>
                <span className="meta">Terms cannot change once accepted. Unaccepted terms lapse after {rules.termsTimeoutDays} days.</span>
              </div>
            </div>
          </div>
        )}
        {r.status === "deposit_pending" && (
          <div className="sheet post">
            <div className="sheet__head"><h3>Deposit</h3><span className="tag tag--lit">Due now</span></div>
            <div className="sheet__pad" style={{ display: "grid", gap: "1.25rem" }}>
              <p className="display t-l num">{formatPaise(deposit)} for {r.reach.length} {r.reach.length === 1 ? "campus" : "campuses"}.</p>
              <p className="small measure">The role goes on the board the moment the payment is captured, and stays open for {rules.broadcastDays} days. The deposit comes back if you work the shortlist and do not hire, and counts toward the fee if you do.</p>
              <div className="actions">
                <button type="button" className="btn btn--ink" onClick={() => payDeposit(r.id)}>Pay {formatPaise(deposit)}<Arrow /></button>
                <span className="meta">Prototype: this simulates a captured Razorpay payment.</span>
              </div>
            </div>
          </div>
        )}
        {r.status === "broadcast" && (
          <div style={{ display: "grid", gap: "1.5rem" }}>
            <div className="note post">
              <b><Countdown ms={r.closesInMs ?? 0} prefix="On the board. Closes in" /></b>
              {r.applicants ?? 0} applicants so far. The shortlist stays hidden until the window closes, so the ranking cannot be second-guessed while it is still moving.
            </div>
            <div className="post" style={{ "--i": 2 } as React.CSSProperties}>
              <Board selected={new Set(r.reach)} compact label={`Campuses this role reaches: ${r.reach.length} of 23`} />
            </div>
          </div>
        )}
        {hasShortlist && (
          <>
            <div className="work__lead">
              <h2 className="display t-m">The shortlist, ranked by fit</h2>
              <p className="meta">Frozen when the window closed. Open a row to act on it.</p>
            </div>
            <div className="post" style={{ "--i": 2 } as React.CSSProperties}>
              <table className="slist">
                <caption className="vh">Shortlisted candidates in rank order</caption>
                <thead><tr><th scope="col">Rank</th><th scope="col">Candidate</th><th scope="col" className="hide-s">Campus</th><th scope="col" className="hide-s">Stage</th><th scope="col" style={{ textAlign: "right" }}>Fit</th></tr></thead>
                <tbody>
                  {matches.map((m, i) => {
                    const settled = SETTLED.includes(m.stage) && m.stage !== "hired";
                    const tag = <span className={`tag${m.stage === "hired" ? " tag--lit" : settled ? " tag--quiet" : m.stage === "shortlisted" ? "" : " tag--ink"}`}>{m.stage === "shortlisted" ? "New" : STAGE_LABEL[m.stage]}</span>;
                    return (
                      <tr key={m.id} className={`srow${settled ? " is-settled" : ""}${m.stage === "hired" ? " is-hired" : ""}`}>
                        <td className="c srow__rank num">{String(i + 1).padStart(2, "0")}</td>
                        <td className="c">
                          <button type="button" className="srow__name" onClick={() => setOpenId(m.id)} aria-haspopup="dialog">{m.name}</button>
                          <span className="meta" style={{ display: "block" }}>{m.title}, {m.employer}</span>
                          <span className="srow__stage-s">{tag}</span>
                        </td>
                        <td className="c hide-s"><span style={{ fontWeight: 600 }}>{campus(m.campus).name}</span><span className="meta" style={{ display: "block" }}>{m.gradYear}, {m.years} yrs</span></td>
                        <td className="c hide-s">{tag}</td>
                        <td className="c srow__fit num">{m.fit}</td>
                      </tr>
                    );
                  })}
                  <tr className="cutline"><td colSpan={5}><div className="cutline__in"><span>The line. {rules.shortlistCap} above it.</span><span>{BELOW_LINE.count} more applied. The longlist is kept by Novare.</span></div></td></tr>
                  <tr className="below" aria-hidden="true">
                    <td className="c srow__rank num">26</td>
                    <td className="c"><span className="redact" style={{ width: "9rem" }} /><span style={{ display: "block", marginTop: "0.4rem" }}><span className="redact" style={{ width: "14rem", maxWidth: "100%" }} /></span></td>
                    <td className="c hide-s"><span className="redact" style={{ width: "6rem" }} /></td>
                    <td className="c hide-s" />
                    <td className="c srow__fit num">{BELOW_LINE.fit}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <aside className="work__side" aria-label="Role facts">
        {fee && hire && hired && (
          <div className="sheet post">
            <div className="sheet__head"><h3>Hire and fee</h3><span className="tag tag--lit">Hire recorded</span></div>
            <div className="sheet__pad">
              <p style={{ fontWeight: 700 }}>{hired.name}</p>
              <p className="meta" style={{ marginBottom: "1rem" }}>Joins {fmtDate(hire.joinedOn)} at {lpa(hire.hiredCtc)}</p>
              <dl className="kv">
                <dt>Fee, {r.terms ? describeTerms(r.terms) : ""}</dt><dd className="num">{formatPaise(fee.fee)}</dd>
                <dt>Deposit applied</dt><dd className="num">minus {formatPaise(fee.applied)}</dd>
                {fee.refund > 0 && <><dt>Deposit refunded</dt><dd className="num">{formatPaise(fee.refund)}</dd></>}
                <div className="kv--total" style={{ display: "contents" }}><dt>To pay by {fmtDate(hire.joinedOn, rules.dueDaysAfterJoin)}</dt><dd className="num">{formatPaise(fee.outstanding)}</dd></div>
              </dl>
              <p className="meta" style={{ margin: "1rem 0" }}>Replacement guarantee runs to {fmtDate(hire.joinedOn, r.terms?.replacementGuaranteeDays ?? rules.replacementDays)}. We ask {hired.name.split(" ")[0]} to confirm joining on the day.</p>
              <button type="button" className="btn btn--sm btn--stop" onClick={didNotJoin}>Candidate did not join</button>
            </div>
          </div>
        )}
        <div className="sheet post" style={{ "--i": 3 } as React.CSSProperties}>
          <div className="sheet__head"><h3>This role</h3><span className="meta">Posted {r.createdOn}</span></div>
          <div className="sheet__pad">
            <dl className="kv">
              <dt>For</dt><dd>{r.type === "intern" ? "Interns" : r.type === "fresher" ? "Freshers" : `${r.yearsExp[0]} to ${r.yearsExp[1]} years`}</dd>
              <dt>Pay</dt><dd>{ctcBand(r.type, r.ctcMin, r.ctcMax)}</dd>
              <dt>Where</dt><dd>{r.locations.join(", ")}</dd>
              <dt>Reach</dt><dd>{r.reach.length} of 23 <MiniBoard reach={r.reach} /></dd>
              <dt>Deposit</dt><dd className="num">{formatPaise(deposit)}. {depositState}</dd>
              {r.terms && <><dt>Fee on a hire</dt><dd>{describeTerms(r.terms)}</dd></>}
              {r.status !== "rejected" && <><dt>Gate</dt><dd style={{ fontWeight: 400 }}>{r.gateNote}</dd></>}
            </dl>
          </div>
        </div>
      </aside>

      <CandidatePanel match={matches.find((m) => m.id === openId) ?? null} onClose={() => setOpenId(null)} />
    </div>
  );
}

/** One shortlisted candidate. Actions follow the §4.3 transition table exactly. */
function CandidatePanel({ match, onClose }: { match: MatchRow | null; onClose: () => void }) {
  const { advance, reject, backedOut, markViewed, hire } = useCompany();
  const ref = useRef<HTMLDialogElement>(null);
  const [offer, setOffer] = useState("");
  const [ctc, setCtc] = useState("");
  const [joined, setJoined] = useState("");
  const [category, setCategory] = useState<RejectionCategory | "">("");
  const id = match?.id;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (id && !d.open) { d.showModal(); markViewed(id); setOffer(""); setCtc(""); setJoined(""); setCategory(""); }
    if (!id && d.open) d.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const m = match;
  const next = m ? NEXT_STAGE[m.stage] : undefined;
  const settled = m ? SETTLED.includes(m.stage) : true;
  const locked = !!hire && m?.stage !== "hired"; // one-hire rule
  return (
    <dialog ref={ref} className="panel" aria-labelledby="panel-h" onClose={onClose} onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}>
      {m && (
        <>
          <div className="panel__head">
            <span className="meta">Rank {String(Number(m.id.slice(1))).padStart(2, "0")} of 25</span>
            <button type="button" className="btn btn--sm" onClick={() => ref.current?.close()}>Close</button>
          </div>
          <div className="panel__body">
            <div>
              <h2 id="panel-h" className="display t-l">{m.name}</h2>
              <p className="meta" style={{ marginTop: "0.5rem" }}>{m.title}, {m.employer}. {m.location}.</p>
            </div>
            <div className="panel__fit">
              <b className="num">{m.fit}</b>
              <p className="small"><span style={{ fontWeight: 700, display: "block" }}>Why this rank</span>{m.reason}</p>
            </div>
            <dl className="kv">
              <dt>Campus</dt><dd>{campus(m.campus).name}</dd>
              <dt>Degree</dt><dd>{m.course}, {m.gradYear}</dd>
              <dt>Experience</dt><dd>{m.years} years</dd>
              <dt>Notice period</dt><dd>{m.noticeDays} days</dd>
              {m.offeredCtc ? <><dt>Offered</dt><dd>{lpa(m.offeredCtc)}</dd></> : null}
            </dl>
            <div className="chips">{m.skills.map((s) => <span key={s} className="tag tag--quiet">{s}</span>)}</div>
            <div>
              <p className="small" style={{ fontWeight: 700, marginBottom: "0.5rem" }}>{STAGE_LABEL[m.stage]}{m.stage === "rejected" && m.rejectionCategory ? `: ${REJECTION_LABEL[m.rejectionCategory].toLowerCase()}` : ""}</p>
              {!settled || m.stage === "hired" ? <StageLamps stage={m.stage} /> : null}
            </div>

            {locked && !settled && <p className="note">A hire is already recorded on this role. Other candidates can only be marked not selected.</p>}

            {!settled && !locked && next === "interviewed" && (
              <button type="button" className="btn btn--ink" onClick={() => advance(m.id)}>Record an interview<Arrow /></button>
            )}
            {!settled && !locked && next === "offered" && (
              <form className="field" onSubmit={(e) => { e.preventDefault(); advance(m.id, { offeredCtc: lakhsToPaise(offer) }); }}>
                <label htmlFor="offer">Offer, lakhs a year</label>
                <div className="linkbox">
                  <input id="offer" className="input" style={{ border: 0 }} inputMode="decimal" required value={offer} onChange={(e) => setOffer(e.target.value.replace(/[^\d.]/g, ""))} />
                  <button type="submit" className="btn btn--ink">Record the offer</button>
                </div>
              </form>
            )}
            {!settled && !locked && next === "offer_accepted" && (
              <button type="button" className="btn btn--ink" onClick={() => advance(m.id)}>Mark the offer accepted<Arrow /></button>
            )}
            {!settled && !locked && next === "hired" && (
              <form className="form" onSubmit={(e) => { e.preventDefault(); advance(m.id, { hiredCtc: lakhsToPaise(ctc), joinedOn: joined }); }}>
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
                  <button type="submit" className="btn btn--ink">Record the hire<Arrow /></button>
                  <button type="button" className="btn btn--sm" onClick={() => backedOut(m.id)}>Candidate backed out</button>
                </div>
                <p className="meta">Recording a hire raises the fee and applies your deposit to it. One hire per role.</p>
              </form>
            )}

            {!settled && (
              <form className="field" style={{ borderTop: "1px solid var(--rule)", paddingTop: "1.25rem" }} onSubmit={(e) => { e.preventDefault(); if (category) reject(m.id, category); }}>
                <label htmlFor="why">Not selecting them</label>
                <div className="linkbox">
                  <select id="why" className="select" style={{ border: 0 }} required value={category} onChange={(e) => setCategory(e.target.value as RejectionCategory)}>
                    <option value="">Choose a reason</option>
                    {REJECTION_CATEGORIES.map((c) => <option key={c} value={c}>{REJECTION_LABEL[c]}</option>)}
                  </select>
                  <button type="submit" className="btn btn--stop">Mark not selected</button>
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
