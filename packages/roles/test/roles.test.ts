import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { schema, type Db } from "@zenhyre/db";
import { testDb } from "@zenhyre/db/test";
import { IllegalTransition, mutableClock } from "@zenhyre/shared";
import { ACTOR_KINDS, ROLE_STATUSES, SYSTEM, canTransition, createRoles, type Actor, type FeeTerms, type Role, type RoleStatus, type Roles } from "../src/index";

const DAY = 24 * 60 * 60 * 1000;
const clock = mutableClock("2026-11-05T10:00:00Z");
let db: Db, close: () => Promise<void>, roles: Roles, companyId: string;
const campusA = "00000000-0000-4000-8000-00000000000a";
const company: Actor = { kind: "company", userId: "11111111-1111-4111-8111-111111111111" };
const staff: Actor = { kind: "staff", userId: "22222222-2222-4222-8222-222222222222" };
const terms: FeeTerms = { kind: "percent", amount: 0.1, replacement_guarantee_days: 90 };
const matchId = "33333333-3333-4333-8333-333333333333";

beforeAll(async () => {
  ({ db, close } = await testDb());
  roles = createRoles(db, { clock });
  const [c] = await db.insert(schema.company).values({ name: "Lab0", verifiedDomain: "lab0.ai" }).returning();
  companyId = c!.id;
});
afterAll(() => close());

const content = { title: "Backend engineer", jd: "x".repeat(220), type: "fresher" as const, ctcMin: 120_000_000, ctcMax: 160_000_000,
  yearsExpMin: 0, yearsExpMax: 1, locations: ["Bengaluru"], campusReach: [campusA] };
const draft = () => roles.create({ companyId, createdBy: company.userId!, content });

/** Walks a fresh role along the legal path to `status`, one second per step so events order by time. */
async function roleAt(status: RoleStatus): Promise<Role> {
  const tick = () => clock.advance(1000);
  let r = await draft();
  const step = async (next: () => Promise<Role>) => { tick(); r = await next(); };
  if (status === "draft") return r;
  if (status === "withdrawn") { await step(() => roles.transition(r.id, "withdrawn", company, "changed our mind")); return r; }
  await step(() => roles.submit(r.id, company));
  if (status === "gated") return r;
  if (status === "rejected") { await step(() => roles.transition(r.id, "rejected", SYSTEM, "Minimum CTC")); return r; }
  await step(() => roles.transition(r.id, "terms_pending", SYSTEM, "accepted", { feeTerms: terms }));
  if (status === "terms_pending") return r;
  tick(); await roles.releaseTerms(r.id);
  await step(() => roles.acceptTerms(r.id, company, { depositAmount: 1_500_000 }));
  if (status === "deposit_pending") return r;
  await step(() => roles.waiveDeposit(r.id, staff, "pilot customer, deposit waived", { broadcastDays: 10 }));
  if (status === "broadcast") return r;
  await step(() => roles.transition(r.id, "shortlist_ready", SYSTEM));
  if (status === "shortlist_ready") return r;
  await step(() => roles.recordHire(r.id, matchId, company));
  if (status === "closing") return r;
  await step(() => roles.transition(r.id, "closed", SYSTEM, "guarantee window ended"));
  return r;
}

describe("create and edit", () => {
  it("creates a draft with its creation event", async () => {
    const r = await draft();
    expect(r).toMatchObject({ status: "draft", companyId, title: "Backend engineer", shortlistCap: 25, nudgeCap: 150, depositMode: null });
    expect(r.ctcMin).toBe(120_000_000);
    expect(r.yearsExpMax).toBe(1);
    expect(await roles.events(r.id)).toMatchObject([{ fromStatus: null, toStatus: "draft", actor: company.userId }]);
  });
  it("stores CTC above the int4 ceiling (₹3 crore a year)", async () => {
    const r = await roles.create({ companyId, createdBy: company.userId!, content: { ...content, type: "experienced", ctcMin: 3_000_000_000, ctcMax: 3_500_000_000 } });
    expect((await roles.get(r.id))!.ctcMax).toBe(3_500_000_000);
  });
  it("lets a draft be incomplete; the gate, not create, judges completeness", async () => {
    const r = await roles.create({ companyId, createdBy: company.userId!, content: { title: "Sketch", type: "intern" } });
    expect(r).toMatchObject({ jd: "", ctcMin: null, locations: [], campusReach: [] });
  });
  it("refuses an empty title, negative money and silly experience", async () => {
    await expect(roles.create({ companyId, createdBy: company.userId!, content: { title: "  ", type: "intern" } })).rejects.toThrow(/title/);
    await expect(roles.create({ companyId, createdBy: company.userId!, content: { ...content, ctcMin: -5 } })).rejects.toThrow(/ctcMin/);
    await expect(roles.create({ companyId, createdBy: company.userId!, content: { ...content, ctcMax: 1.5 } })).rejects.toThrow(/ctcMax/);
    await expect(roles.create({ companyId, createdBy: company.userId!, content: { ...content, yearsExpMax: 99 } })).rejects.toThrow(/yearsExpMax/);
  });
  it("edits content while draft, and never after", async () => {
    const r = await draft();
    expect((await roles.update(r.id, { title: "Platform engineer", locations: ["Pune"] })).title).toBe("Platform engineer");
    await roles.submit(r.id, company);
    await expect(roles.update(r.id, { title: "Sneaky" })).rejects.toThrow(/can no longer be edited/);
  });
  it("lets the reach change at the gate (staff adjust it), but nothing else", async () => {
    const r = await roleAt("gated");
    const campusB = "00000000-0000-4000-8000-00000000000b";
    expect((await roles.update(r.id, { campusReach: [campusB] })).campusReach).toEqual([campusB]);
    await expect(roles.update(r.id, { campusReach: [campusA], jd: "new" })).rejects.toThrow(/can no longer be edited/);
    const later = await roleAt("terms_pending");
    await expect(roles.update(later.id, { campusReach: [campusB] })).rejects.toThrow(/can no longer be edited/);
  });
  it("keeps bookkeeping fields editable in any state and never touches status", async () => {
    const r = await roleAt("broadcast");
    const u = await roles.update(r.id, { jobError: "embed failed", shortlistCap: 3 });
    expect(u).toMatchObject({ jobError: "embed failed", shortlistCap: 3, status: "broadcast" });
    await expect(roles.update(r.id, { shortlistCap: 0 })).rejects.toThrow(/shortlistCap/);
    expect(await roles.update(r.id, { status: "closed", jobError: null } as any)).toMatchObject({ status: "broadcast", jobError: null });
    expect(await roles.update(r.id, { status: "closed" } as any)).toMatchObject({ status: "broadcast" });
  });
  it("lists a company's roles and roles by status", async () => {
    const r = await draft();
    expect((await roles.listForCompany(companyId)).map((x) => x.id)).toContain(r.id);
    expect((await roles.listByStatus("draft")).every((x) => x.status === "draft")).toBe(true);
    expect((await roles.listByStatus(["closed", "withdrawn"])).every((x) => x.status !== "draft")).toBe(true);
    await expect(roles.require("99999999-9999-4999-8999-999999999999")).rejects.toThrow(/not found/);
  });
});

describe("the happy path (§5)", () => {
  it("draft → gated → terms_pending → deposit_pending → broadcast → shortlist_ready → closing → closed, one event per move", async () => {
    const r = await roleAt("closed");
    const ev = await roles.events(r.id);
    expect(ev.map((e) => e.toStatus)).toEqual(["draft", "gated", "terms_pending", "deposit_pending", "broadcast", "shortlist_ready", "closing", "closed"]);
    expect(ev.map((e) => e.fromStatus)).toEqual([null, "draft", "gated", "terms_pending", "deposit_pending", "broadcast", "shortlist_ready", "closing"]);
    expect(ev.map((e) => e.actor)).toEqual([company.userId, company.userId, "system", company.userId, staff.userId, "system", company.userId, "system"]);
    expect(ev.find((e) => e.toStatus === "broadcast")!.note).toBe("pilot customer, deposit waived");
  });
});

describe("every move against the database", () => {
  // Data that satisfies each move's own precondition, so the only thing that can refuse is the lifecycle table.
  const opts = { feeTerms: terms, depositAmount: 1_500_000, broadcastDays: 10, hiredMatchId: matchId, appealWindowDays: 14 };
  const actors: Record<(typeof ACTOR_KINDS)[number], Actor> = { company, staff, system: SYSTEM };
  for (const from of ROLE_STATUSES) {
    it(`from ${from}: legal moves succeed and write an event, illegal ones throw IllegalTransition and change nothing`, async () => {
      for (const to of ROLE_STATUSES) for (const kind of ACTOR_KINDS) {
        const r = await roleAt(from);
        if (from === "terms_pending") await roles.releaseTerms(r.id);
        const before = (await roles.events(r.id)).length;
        clock.advance(1000);
        const attempt = roles.transition(r.id, to, actors[kind], "note", opts);
        if (canTransition(from, to, kind)) {
          expect((await attempt).status, `${from} → ${to} by ${kind}`).toBe(to);
          expect((await roles.events(r.id)).at(-1)).toMatchObject({ fromStatus: from, toStatus: to });
        } else {
          await expect(attempt, `${from} → ${to} by ${kind}`).rejects.toBeInstanceOf(IllegalTransition);
          expect((await roles.get(r.id))!.status).toBe(from);
          expect(await roles.events(r.id)).toHaveLength(before);
        }
      }
    });
  }
});

describe("gate", () => {
  it("records decisions in order and points the role at the latest", async () => {
    const r = await roleAt("gated");
    const d1 = await roles.recordGateDecision(r.id, { stage: "rules", outcome: "accept", reason: "Passed the rules.", decidedBy: "system" });
    clock.advance(1000);
    const d2 = await roles.recordGateDecision(r.id, { stage: "model", outcome: "needs_review", reason: "Borderline.", modelScore: 55, suggestedReach: [campusA], decidedBy: "system" });
    expect((await roles.get(r.id))!.finalGateDecisionId).toBe(d2.id);
    expect((await roles.gateDecisions(r.id)).map((d) => d.id)).toEqual([d1.id, d2.id]);
    expect(await roles.finalGateDecision((await roles.get(r.id))!)).toMatchObject({ stage: "model", modelScore: 55, suggestedReach: [campusA] });
    expect((await roles.get(r.id))!.status).toBe("gated"); // needs_review stays gated
  });
  it("gate acceptance needs prefilled terms and stores them", async () => {
    const r = await roleAt("gated");
    await expect(roles.transition(r.id, "terms_pending", SYSTEM)).rejects.toThrow(/prefilled fee terms/);
    const t = await roles.transition(r.id, "terms_pending", SYSTEM, "accepted", { feeTerms: terms });
    expect(t).toMatchObject({ status: "terms_pending", feeTerms: terms, feeTermsReleasedAt: null });
  });
});

describe("appeal (§5: once, within 14 days)", () => {
  it("re-enters the gate", async () => {
    const r = await roleAt("rejected");
    clock.advance(13 * DAY);
    expect((await roles.appeal(r.id, company, { appealWindowDays: 14 })).status).toBe("gated");
  });
  it("is refused after the window", async () => {
    const r = await roleAt("rejected");
    clock.advance(14 * DAY + 1000);
    await expect(roles.appeal(r.id, company, { appealWindowDays: 14 })).rejects.toThrow(/appeal window has closed/);
    expect((await roles.get(r.id))!.status).toBe("rejected");
  });
  it("is refused a second time", async () => {
    const r = await roleAt("rejected");
    await roles.appeal(r.id, company, { appealWindowDays: 14 });
    clock.advance(1000);
    await roles.transition(r.id, "rejected", staff, "still not a fit");
    await expect(roles.appeal(r.id, company, { appealWindowDays: 14 })).rejects.toThrow(/already been appealed/);
  });
});

describe("fee terms (§7)", () => {
  it("staff can edit terms until acceptance; nobody can after", async () => {
    const r = await roleAt("terms_pending");
    const edited: FeeTerms = { kind: "percent", amount: 0.08, replacement_guarantee_days: 60, notes: "negotiated" };
    expect((await roles.setFeeTerms(r.id, edited)).feeTerms).toEqual(edited);
    await roles.releaseTerms(r.id);
    await roles.setFeeTerms(r.id, { ...edited, amount: 0.09 }); // released but not yet accepted: still editable
    const accepted = await roles.acceptTerms(r.id, company, { depositAmount: 1_500_000 });
    expect(accepted.feeTerms).toMatchObject({ amount: 0.09 });
    await expect(roles.setFeeTerms(r.id, edited)).rejects.toThrow(/waiting for acceptance/);
    expect((await roles.get(r.id))!.feeTerms).toMatchObject({ amount: 0.09 });
  });
  it("refuses malformed terms and terms on a role that is not waiting for them", async () => {
    const r = await roleAt("terms_pending");
    await expect(roles.setFeeTerms(r.id, { kind: "percent", amount: 12, replacement_guarantee_days: 90 })).rejects.toThrow(/fraction/);
    await expect(roles.setFeeTerms((await roleAt("gated")).id, terms)).rejects.toThrow(/waiting for acceptance/);
  });
  it("a company cannot accept terms it has not been shown", async () => {
    const r = await roleAt("terms_pending");
    await expect(roles.acceptTerms(r.id, company, { depositAmount: 1_500_000 })).rejects.toThrow(/not been released/);
    expect((await roles.get(r.id))!.status).toBe("terms_pending");
  });
  it("release is idempotent and only for roles waiting on terms", async () => {
    const r = await roleAt("terms_pending");
    const first = await roles.releaseTerms(r.id);
    expect(first.released).toBe(true);
    clock.advance(1000);
    const again = await roles.releaseTerms(r.id);
    expect(again.released).toBe(false);
    expect(again.role.feeTermsReleasedAt).toEqual(first.role.feeTermsReleasedAt);
    await expect(roles.releaseTerms((await roleAt("gated")).id)).rejects.toThrow(/waiting on terms/);
  });
  it("acceptance stores the time and the deposit owed, and needs an amount", async () => {
    const r = await roleAt("terms_pending");
    await roles.releaseTerms(r.id);
    await expect(roles.transition(r.id, "deposit_pending", company)).rejects.toThrow(/deposit amount/);
    clock.advance(1000);
    const a = await roles.acceptTerms(r.id, company, { depositAmount: 3_000_000 });
    expect(a).toMatchObject({ status: "deposit_pending", depositAmount: 3_000_000, depositMode: null });
    expect(a.feeTermsAcceptedAt).toEqual(clock.now());
  });
  it("finds terms that have waited 48 hours for staff", async () => {
    const waiting = await roleAt("terms_pending");
    const released = await roleAt("terms_pending");
    await roles.releaseTerms(released.id);
    clock.advance(47 * 60 * 60 * 1000);
    expect((await roles.listTermsAwaitingRelease(48)).map((r) => r.id)).not.toContain(waiting.id);
    clock.advance(2 * 60 * 60 * 1000);
    const due = (await roles.listTermsAwaitingRelease(48)).map((r) => r.id);
    expect(due).toContain(waiting.id);
    expect(due).not.toContain(released.id);
  });
});

describe("deposit waiver (§5, Slice 1: deposit_mode = waived only)", () => {
  it("needs a staff actor and a note, and opens the broadcast window", async () => {
    const r = await roleAt("deposit_pending");
    await expect(roles.waiveDeposit(r.id, company, "let us in", { broadcastDays: 10 })).rejects.toBeInstanceOf(IllegalTransition);
    await expect(roles.waiveDeposit(r.id, SYSTEM, "auto", { broadcastDays: 10 })).rejects.toBeInstanceOf(IllegalTransition);
    await expect(roles.waiveDeposit(r.id, staff, "  ", { broadcastDays: 10 })).rejects.toThrow(/needs a note/);
    await expect(roles.transition(r.id, "broadcast", staff, "ok")).rejects.toThrow(/length in days/);
    expect((await roles.get(r.id))!.status).toBe("deposit_pending");
    clock.advance(1000);
    const b = await roles.waiveDeposit(r.id, staff, "pilot customer", { broadcastDays: 10 });
    expect(b).toMatchObject({ status: "broadcast", depositMode: "waived" });
    expect(b.broadcastOpensAt).toEqual(clock.now());
    expect(b.broadcastClosesAt).toEqual(new Date(clock.now().getTime() + 10 * DAY));
  });
  it("finds broadcasts whose window has ended", async () => {
    const r = await roleAt("broadcast");
    clock.advance(10 * DAY - 60_000);
    expect((await roles.listBroadcastsDue()).map((x) => x.id)).not.toContain(r.id);
    clock.advance(60_000);
    expect((await roles.listBroadcastsDue()).map((x) => x.id)).toContain(r.id);
  });
});

describe("hire, reopen, close", () => {
  it("freezing stamps shortlist_ready_at", async () => {
    const r = await roleAt("shortlist_ready");
    expect(r.shortlistReadyAt).toEqual(clock.now());
  });
  it("a company closes a role only by recording a hire; the system may close an abandoned one", async () => {
    const r = await roleAt("shortlist_ready");
    await expect(roles.transition(r.id, "closing", company)).rejects.toThrow(/recording a hire/);
    clock.advance(1000);
    const hired = await roles.recordHire(r.id, matchId, company);
    expect(hired).toMatchObject({ status: "closing", hiredMatchId: matchId });
    expect(hired.hiredAt).toEqual(clock.now());
    const dark = await roleAt("shortlist_ready");
    expect(await roles.transition(dark.id, "closing", SYSTEM, "no hire in 30 days")).toMatchObject({ status: "closing", hiredMatchId: null, hiredAt: null });
  });
  it("reopen clears the hire and restarts the shortlist clock", async () => {
    const r = await roleAt("closing");
    const firstReady = r.shortlistReadyAt!;
    clock.advance(5 * DAY);
    const reopened = await roles.reopen(r.id, company);
    expect(reopened).toMatchObject({ status: "shortlist_ready", hiredMatchId: null, hiredAt: null });
    expect(reopened.shortlistReadyAt).toEqual(clock.now());
    expect(reopened.shortlistReadyAt!.getTime()).toBeGreaterThan(firstReady.getTime());
    // …and the role can take a second hire.
    const second = "44444444-4444-4444-8444-444444444444";
    expect((await roles.recordHire(r.id, second, company)).hiredMatchId).toBe(second);
  });
  it("a closing role without a hire cannot reopen", async () => {
    const r = await roleAt("shortlist_ready");
    await roles.transition(r.id, "closing", SYSTEM, "no hire in 30 days");
    await expect(roles.reopen(r.id, staff)).rejects.toThrow(/recorded hire/);
  });
  it("closing holds: it cannot be withdrawn, and only the system or staff close it", async () => {
    const r = await roleAt("closing");
    for (const a of [company, staff, SYSTEM]) await expect(roles.transition(r.id, "withdrawn", a, "x")).rejects.toBeInstanceOf(IllegalTransition);
    await expect(roles.transition(r.id, "closed", company)).rejects.toBeInstanceOf(IllegalTransition);
    expect((await roles.get(r.id))!.status).toBe("closing");
    expect((await roles.transition(r.id, "closed", SYSTEM, "guarantee window ended")).status).toBe("closed");
  });
  it("loses a race cleanly: of two concurrent moves, one is refused", async () => {
    const r = await roleAt("shortlist_ready");
    const results = await Promise.allSettled([
      roles.recordHire(r.id, matchId, company),
      roles.transition(r.id, "withdrawn", company, "withdrawn"),
    ]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(results.find((x) => x.status === "rejected")).toMatchObject({ reason: expect.any(IllegalTransition) });
    expect(await roles.events(r.id)).toHaveLength(7);
  });
});

describe("lock", () => {
  it("returns the current row, and inside a transaction makes a second writer wait for the first", async () => {
    const r = await roleAt("broadcast");
    expect((await roles.lock(r.id)).status).toBe("broadcast");
    await expect(roles.lock("99999999-9999-4999-8999-999999999999")).rejects.toThrow(/not found/);

    const order: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((res) => { release = res; });
    const first = db.transaction(async (tx) => {
      const a = roles.withDb(tx);
      await a.lock(r.id);
      order.push("first has the row");
      await held;
      await a.transition(r.id, "shortlist_ready", SYSTEM);
      order.push("first froze");
    });
    await new Promise((res) => setTimeout(res, 50));
    const second = db.transaction(async (tx) => {
      const seen = await roles.withDb(tx).lock(r.id);
      order.push(`second saw ${seen.status}`);
    });
    await new Promise((res) => setTimeout(res, 100));
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["first has the row", "first froze", "second saw shortlist_ready"]);
  });
});

describe("merge", () => {
  it("moves a company's roles to the survivor", async () => {
    const [other] = await db.insert(schema.company).values({ name: "Lab1", verifiedDomain: "lab1.ai" }).returning();
    const r = await roles.create({ companyId: other!.id, createdBy: company.userId!, content });
    expect(await roles.reassignCompany(other!.id, companyId)).toBe(1);
    expect((await roles.get(r.id))!.companyId).toBe(companyId);
    await db.delete(schema.company).where(eq(schema.company.id, other!.id)); // no FK left behind
  });
});

describe("what the closing jobs sweep for (§18)", () => {
  const ids = (rs: Role[]) => rs.map((r) => r.id);
  it("terms timeout: released terms left unaccepted, counted from release", async () => {
    const unreleased = await roleAt("terms_pending");
    const released = await roleAt("terms_pending");
    await roles.releaseTerms(released.id);
    const accepted = await roleAt("deposit_pending");
    clock.advance(14 * DAY - 60_000);
    expect(ids(await roles.listTermsTimedOut(14))).not.toContain(released.id);
    clock.advance(60_000);
    const due = ids(await roles.listTermsTimedOut(14));
    expect(due).toContain(released.id);
    expect(due).not.toContain(unreleased.id); // never shown to the company, so its clock has not started
    expect(due).not.toContain(accepted.id);
  });
  it("dark check: shortlists with no hire, counted from the last time they were made ready", async () => {
    const dark = await roleAt("shortlist_ready");
    const reopened = await roleAt("closing");
    clock.advance(20 * DAY);
    await roles.reopen(reopened.id, company);
    const hired = await roleAt("closing");
    clock.advance(10 * DAY - 60_000);
    expect(ids(await roles.listShortlistsDark(30))).not.toContain(dark.id);
    clock.advance(60_000);
    const due = ids(await roles.listShortlistsDark(30));
    expect(due).toContain(dark.id);
    expect(due).not.toContain(reopened.id); // the reopen restarted its clock
    expect(due).not.toContain(hired.id);
    clock.advance(20 * DAY);
    expect(ids(await roles.listShortlistsDark(30))).toContain(reopened.id);
  });
  it("guarantee expiry: roles holding in closing on a hire, not abandoned or closed ones", async () => {
    const hired = await roleAt("closing");
    const abandoned = await roleAt("shortlist_ready");
    await roles.transition(abandoned.id, "closing", SYSTEM, "no hire in 30 days");
    const closed = await roleAt("closed");
    const found = ids(await roles.listClosingWithHire());
    expect(found).toContain(hired.id);
    expect(found).not.toContain(abandoned.id);
    expect(found).not.toContain(closed.id);
  });
});
