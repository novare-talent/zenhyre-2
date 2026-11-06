import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Bar } from "@/components/Bar";
import { Arrow } from "@/components/Icons";
import { COOKIE, currentSession, heldSeats, isSeat, SEAT_LABEL } from "@/lib/session";

export const metadata: Metadata = { title: "Finish logging in", description: "Confirm the sign-in link from your email to open your Zenhyre seat.", robots: { index: false } };

/** Landing for the emailed link. The token is only redeemed when the person presses the button. */
export default async function Page({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  const s = await currentSession();
  if (s?.seat && heldSeats(s.me).includes(s.seat)) redirect(`/${s.seat}`); // already in: an old link has nothing to do
  const intent = (await cookies()).get(COOKIE.intent)?.value;
  return (
    <>
      <Bar />
      <main id="main" tabIndex={-1} className="auth wrap grid12">
        <div className="auth__copy" style={{ gridColumn: "1 / span 8" }}>
          <h1 className="display t-xl post-solid">One more step.</h1>
          <p className="lede post" style={{ "--i": 3 } as React.CSSProperties}>
            {isSeat(intent) ? `You are logging in to the ${SEAT_LABEL[intent].toLowerCase()} seat.` : "You are logging in to Zenhyre."} Press the button to finish. The link in your email stops working once you do.
          </p>
          <form action="/api/auth/redeem" method="post" className="post" style={{ "--i": 5 } as React.CSSProperties}>
            <input type="hidden" name="t" value={t ?? ""} />
            <button type="submit" className="btn btn--ink" style={{ minHeight: "3.25rem" }}>Finish logging in<Arrow /></button>
          </form>
        </div>
      </main>
    </>
  );
}
