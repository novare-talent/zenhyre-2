"use client";
import { MiniBoard } from "@/components/Board";
import { Countdown } from "@/components/Clock";
import { useNotify } from "@/components/Toasts";
import { BOARD_ROLES, REFERRALS } from "@/data/fixtures";
import { ctcBand } from "@/lib/rules";

export function Referrals() {
  const notify = useNotify();
  const copy = async (url: string) => {
    try { await navigator.clipboard.writeText(`https://${url}`); notify("Link copied."); }
    catch { notify(`Copy this link: https://${url}`); }
  };
  return (
    <div className="work wrap">
      <div className="work__main">
        <div className="work__lead">
          <h2 className="display t-m">{REFERRALS.length} links, ready to post</h2>
          <p className="meta">Role briefs arrive the hour a role goes on the board.</p>
        </div>
        <ul className="rows">
          {REFERRALS.map((ref, i) => {
            const role = BOARD_ROLES.find((r) => r.id === ref.roleId);
            const url = `zenhyre.com/r/${ref.token}`;
            return (
              <li key={ref.id} className="row post" style={{ "--i": i + 2 } as React.CSSProperties}>
                <div style={{ padding: "1.25rem", display: "grid", gap: "0.9rem" }}>
                  <div className="role-row" style={{ display: "grid" }}>
                    <div>
                      <h3 className="role-row__title">{ref.label}</h3>
                      <p className="meta" style={{ marginTop: "0.2rem" }}>
                        {role
                          ? <>{role.yearsExp[0]} to {role.yearsExp[1]} years, {ctcBand(role.type, role.ctcMin, role.ctcMax)}. {role.locations.join(" or ")}. <MiniBoard reach={role.reach} /></>
                          : "Not tied to a role. Use it in newsletters and group chats."}
                      </p>
                    </div>
                    <div className="role-row__right">
                      {role ? <span className="small"><Countdown ms={role.closesInMs} /></span> : <span className="tag tag--quiet">Always open</span>}
                    </div>
                  </div>
                  <div className="linkbox">
                    <code>{url}</code>
                    <button type="button" className="btn" onClick={() => copy(url)} aria-label={`Copy link: ${ref.label}`}>Copy link</button>
                  </div>
                  <p className="small"><b className="num">{ref.signups}</b> new alumni signed up through it{role ? <>, and <b className="num">{ref.visits}</b> existing members opened the role</> : null}.</p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      <aside className="work__side" aria-label="What a link does">
        <div className="sheet post" style={{ "--i": 4 } as React.CSSProperties}>
          <div className="sheet__head"><h3>What a link does</h3></div>
          <div className="sheet__pad" style={{ display: "grid", gap: "0.9rem" }}>
            <p className="small">An alum who signs up through your link lands in your verification queue and can apply to that role straight away.</p>
            <p className="small">If they are hired, the hire is attributed to you. A link for the role itself counts first, then any earlier link of yours, then the fact that you verified them.</p>
            <p className="small">Students verified by campus email never attribute. They belong to the free campus channel.</p>
          </div>
        </div>
      </aside>
    </div>
  );
}
