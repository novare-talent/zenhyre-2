"use client";
import { useCandidate } from "@/seats/candidate";
import { StageLamps } from "@/components/StageLamps";
import { CAN_WITHDRAW, REJECTION_LABEL, STAGE_LABEL, STAGE_ORDER } from "@/lib/rules";

export function Applications() {
  const { apps, withdraw, answerJoin } = useCandidate();
  const prompt = apps.find((a) => a.stage === "hired" && !a.joinAnswer);

  return (
    <div className="work wrap">
      <div className="work__main">
        {prompt && (
          <div className="note post" style={{ marginBottom: "1.5rem" }}>
            <b>Did you join {prompt.company} on {prompt.joinedOn}?</b>
            <span>The company recorded your hire. Your answer confirms it, and it decides when their fee falls due.</span>
            <div className="actions" style={{ marginTop: "0.9rem" }}>
              <button type="button" className="btn btn--ink btn--sm" onClick={() => answerJoin(prompt.id, "yes")}>Yes, I joined</button>
              <button type="button" className="btn btn--sm" onClick={() => answerJoin(prompt.id, "no")}>No, I did not</button>
            </div>
          </div>
        )}
        <div className="work__lead">
          <h2 className="display t-m">{apps.length} applications</h2>
          <p className="meta">Newest first.</p>
        </div>
        <ul className="rows">
          {apps.map((a, i) => {
            const stopped = a.stage === "rejected" || a.stage === "withdrawn" || a.stage === "offer_reneged";
            return (
              <li key={a.id} className="row post" style={{ "--i": i + 2 } as React.CSSProperties}>
                <div style={{ padding: "1.1rem 1.25rem", display: "grid", gap: "0.8rem" }}>
                  <div className="role-row" style={{ display: "grid" }}>
                    <div>
                      <h3 className="role-row__title">{a.title}</h3>
                      <p className="meta" style={{ marginTop: "0.2rem" }}>{a.company}. {a.location}. Applied {a.appliedOn === "Today" ? "today" : `on ${a.appliedOn}`}.</p>
                    </div>
                    <div className="role-row__right">
                      <span className={`tag${a.stage === "hired" ? " tag--lit" : stopped ? " tag--stop" : " tag--ink"}`}>{STAGE_LABEL[a.stage]}</span>
                    </div>
                  </div>
                  {!stopped && <StageLamps stage={a.stage} />}
                  {a.stage === "rejected" && a.rejectionCategory && <p className="small">Reason given by the company: {REJECTION_LABEL[a.rejectionCategory].toLowerCase()}. Companies share a category, not a note.</p>}
                  {a.stage === "hired" && a.joinAnswer === "yes" && <p className="small">Joining confirmed by you. Congratulations.</p>}
                  {a.stage === "hired" && a.joinAnswer === "no" && <p className="small stop">You told us you did not join. A dispute is open and the Novare team is following up.</p>}
                  {CAN_WITHDRAW.includes(a.stage) && (
                    <div className="actions">
                      <button type="button" className="btn btn--sm" onClick={() => withdraw(a.id)}>Withdraw</button>
                      {a.stage === "offer_accepted" && <span className="meta">Withdrawing after accepting an offer counts against you.</span>}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
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
