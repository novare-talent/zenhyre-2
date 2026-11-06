import Link from "next/link";
import { Bar } from "@/components/Bar";
import { Footer } from "@/components/Footer";
import { HeroBoard } from "@/components/HeroBoard";
import { Arrow } from "@/components/Icons";
import { LoopTrack } from "@/components/LoopTrack";
import { BOARD_ROLES } from "@/data/fixtures";
import { rulesFromConfig } from "@/lib/config";
import { formatPaise } from "@/lib/rules";

export default function Home() {
  const r = rulesFromConfig();
  const [t1, t2, t3] = r.depositTiers;
  const pct = (n: number) => Math.round(n * 100);

  const stops = [
    { name: "Draft", rule: "A company writes the role and picks its campuses by name." },
    { name: "Gate", rule: `Rules first, a model second, a person on the borderline. ${r.blocklist.length} role categories never pass.` },
    { name: "Terms", rule: `Fee terms are set per role: ${pct(r.percentDefault)}% of annual CTC, or ${formatPaise(r.internFlat)} flat for interns.` },
    { name: "Deposit", rule: `${formatPaise(t1!.amount)}, ${formatPaise(t2!.amount)} or ${formatPaise(t3!.amount)} by campus count. Refundable, never a wallet.` },
    { name: "Broadcast", rule: `Open for ${r.broadcastDays} days. Every verified candidate who fits is matched, and the best ${r.nudgeCap} are nudged.` },
    { name: "Shortlist", rule: `The window closes and the top ${r.shortlistCap} applicants by fit are frozen in rank order.` },
    { name: "Closing", rule: `A hire raises the fee and applies the deposit to it. A ${r.replacementDays}-day replacement guarantee starts.` },
    { name: "Closed", rule: "Nothing is owed either way. The history stays, entry by entry." },
  ];

  return (
    <>
      <Bar />
      <main id="main" tabIndex={-1}>
        <section className="hero wrap grid12" aria-labelledby="hero-h">
          <div className="hero__copy">
            <h1 id="hero-h" className="display t-xl">
              <span className="post-solid" style={{ display: "block" }}>Twenty-three campuses.</span>
              <span className="post-solid" style={{ display: "block", "--i": 1 } as React.CSSProperties}>One shortlist of twenty&#8209;five.</span>
            </h1>
            <p className="lede post" style={{ "--i": 6 } as React.CSSProperties}>
              Zenhyre is a hiring platform for IIT talent. A company switches on the campuses it wants, pays a refundable deposit, and reads a ranked shortlist when the window closes.
            </p>
            <div className="hero__cta post" style={{ "--i": 9 } as React.CSSProperties}>
              <Link href="/login" className="btn btn--ink">Log in<Arrow /></Link>
              <a href="#seats" className="btn">See who it is for</a>
            </div>
          </div>
          <div className="hero__board post" style={{ "--i": 3 } as React.CSSProperties}>
            <HeroBoard />
          </div>
        </section>

        <section className="section--tight wrap" id="seats" aria-labelledby="seats-h">
          <div className="section__head">
            <h2 id="seats-h" className="display t-l" data-reveal>Three seats at the same board</h2>
            <p className="meta" data-reveal>Pick the one that is yours. Each email holds a single role.</p>
          </div>
          <div className="seats">
            <Link href="/login?as=candidate" className="seat-row" data-reveal>
              <span className="seat-row__name display t-xl">Candidate</span>
              <span className="seat-row__what">IIT students and alumni. Verified once, nudged when a role fits, and told where every application stands.</span>
              <span className="seat-row__live meta">Log in with your LDAP ID or a personal email</span>
              <Arrow className="seat-row__go" />
            </Link>
            <Link href="/login?as=company" className="seat-row" data-reveal>
              <span className="seat-row__name display t-xl">Company</span>
              <span className="seat-row__what">Post a role, pass the gate, switch on campuses, read the shortlist of {r.shortlistCap}, record the hire.</span>
              <span className="seat-row__live meta">Log in with a work email only</span>
              <Arrow className="seat-row__go" />
            </Link>
            <Link href="/login?as=association" className="seat-row" data-reveal>
              <span className="seat-row__name display t-xl">Association</span>
              <span className="seat-row__what">Verify alumni, share role links with the network, and see what attributed hires have earned.</span>
              <span className="seat-row__live meta">Log in with the login Novare created for you</span>
              <Arrow className="seat-row__go" />
            </Link>
          </div>
        </section>

        <section className="section wrap" aria-labelledby="loop-h">
          <div className="section__head">
            <h2 id="loop-h" className="display t-l" data-reveal>How a role moves</h2>
            <p className="meta" data-reveal>Eight states, in order. Every change is written down as its own entry, so balances and scores are always worked out from history.</p>
          </div>
          <LoopTrack stops={stops} />
        </section>

        <section className="section--tight wrap" aria-labelledby="num-h" style={{ paddingBottom: "clamp(4rem, 9vw, 9rem)" }}>
          <div className="section__head">
            <h2 id="num-h" className="display t-l" data-reveal>The rules, in numbers</h2>
            <p className="meta" data-reveal>These are the defaults in the config table today. Staff can change any of them without a release.</p>
          </div>
          <dl className="figures">
            {[
              ["23", "", "IIT campuses a role can reach, picked by name"],
              [String(r.shortlistCap), "", "applicants on a frozen shortlist, ranked by fit"],
              [String(r.broadcastDays), "days", "a role stays open on the board"],
              [String(pct(r.percentDefault)), "%", `of annual CTC on a hire, ${pct(r.percentSenior)}% for roles needing ${r.seniorYears} years or more`],
              [String(pct(r.shareRate)), "%", "of each fee collected goes to the association that brought the hire"],
              [String(r.replacementDays), "days", "replacement guarantee after the candidate joins"],
            ].map(([n, unit, text], i) => (
              <div className="figure" key={text} data-reveal style={{ "--i": i } as React.CSSProperties}>
                <dt className="vh">{text}</dt>
                <dd><b className="num">{n}{unit ? <small>{unit === "%" ? "%" : ` ${unit}`}</small> : null}</b><span>{text}</span></dd>
              </div>
            ))}
          </dl>
        </section>
      </main>
      <Footer />
    </>
  );
}
