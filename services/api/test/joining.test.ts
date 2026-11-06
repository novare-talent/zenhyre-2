// §9.2 Joining: the "did you join?" prompt, the candidate's answer, the grace period, and the dispute a "no" opens.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { schema } from "@zenhyre/db";
import { DAY, MINUTE, body, post, world, type Seat, type World } from "./world";

describe("confirmJoin (§9.2)", () => {
  let w: World, a: Seat, b: Seat, c: Seat, d: Seat;
  beforeAll(async () => {
    w = await world();
    [a, b, c, d] = [await w.candidate("a", 80), await w.candidate("b", 70), await w.candidate("c", 60), await w.candidate("d", 50)];
  });
  afterAll(() => w.t.close());

  /** A role whose only applicant is hired, joining on `joinedOn`. */
  async function hired(title: string, s: Seat, joinedOn: string) {
    const { id, match } = await w.shortlisted(title, [s]);
    await w.hire(match[s.email]!, joinedOn);
    return { roleId: id, matchId: match[s.email]! };
  }
  const answer = (s: Seat, matchId: string, joined: boolean) => s.req(`/me/applications/${matchId}/join`, post({ joined }));
  const disputes = async (matchId: string) => (await body(await w.staff.req("/admin/reviews?kind=join_dispute"))).items.filter((i: any) => i.refId === matchId);
  const match = async (matchId: string) => (await w.t.db.select().from(schema.match).where(eq(schema.match.id, matchId)))[0]!;
  const resolve = (who: Seat, itemId: string, payload: Record<string, unknown>) => who.req(`/admin/reviews/${itemId}/resolve`, post(payload));

  it("asks the hire once the joining date has come; a yes confirms the joining", async () => {
    const { roleId, matchId } = await hired("Engineer, joined", a, "2026-11-08");
    expect(await w.runJob("role.join_prompt")).toMatchObject({ job: "role.join_prompt", roles: 0 }); // joins in three days
    const early = await answer(a, matchId, true);
    expect(early.status).toBe(409);
    expect(await body(early)).toMatchObject({ error: "not_actionable" });

    w.t.clock.set("2026-11-08T00:00:00Z");
    expect(await w.runJob("role.join_prompt")).toMatchObject({ roles: 1 });
    expect(w.subjects(a)).toContain("Did you join Lab0?");
    expect((await match(matchId)).joinPromptSentAt).toEqual(w.t.clock.now());
    expect(await w.runJob("role.join_prompt")).toMatchObject({ roles: 0 }); // asked once
    expect(w.subjects(a).filter((s) => s === "Did you join Lab0?")).toHaveLength(1);
    expect((await body(await a.req("/me/applications"))).applications[0]).toMatchObject({ stage: "hired", joinPromptSentAt: w.t.clock.now().toISOString(), joinConfirmedAt: null });

    expect((await answer(b, matchId, true)).status).toBe(404); // not their application
    expect((await a.req(`/me/applications/${matchId}/join`, post({}))).status).toBe(400);
    const yes = await answer(a, matchId, true);
    expect(yes.status).toBe(200);
    expect((await body(yes)).application).toMatchObject({ stage: "hired", joinConfirmedAt: w.t.clock.now().toISOString() });
    expect(await match(matchId)).toMatchObject({ stage: "hired", joinConfirmedBy: "candidate" });
    const trail = await w.t.db.select().from(schema.matchEvent).where(eq(schema.matchEvent.matchId, matchId)).orderBy(asc(schema.matchEvent.seq));
    expect(trail.at(-1)).toMatchObject({ fromStage: "hired", toStage: "hired", actor: a.userId, data: { join_confirmed_by: "candidate" } });

    // Settled: no second answer, and the company can no longer say the candidate did not join.
    expect((await answer(a, matchId, false)).status).toBe(409);
    expect((await w.act(matchId, { stage: "did_not_join" })).status).toBe(409);
    expect(await w.runJob("role.join_grace")).toMatchObject({ roles: 0 });
    expect(await disputes(matchId)).toEqual([]);
    expect((await w.row(roleId)).status).toBe("closing");
  });

  it("no answer for seven days confirms the joining by grace", async () => {
    const { matchId } = await hired("Engineer, silent", b, "2026-11-01"); // already joined when the hire was recorded
    expect(await w.runJob("role.join_prompt")).toMatchObject({ roles: 1 });
    w.t.clock.advance(7 * DAY - MINUTE);
    expect(await w.runJob("role.join_grace")).toMatchObject({ job: "role.join_grace", roles: 0 });
    w.t.clock.advance(MINUTE);
    expect(await w.runJob("role.join_grace")).toMatchObject({ roles: 1 });
    expect(await match(matchId)).toMatchObject({ stage: "hired", joinConfirmedAt: w.t.clock.now(), joinConfirmedBy: "grace" });
    expect((await answer(b, matchId, false)).status).toBe(409); // too late to dispute
    expect(await w.runJob("role.join_grace")).toMatchObject({ roles: 0 });
  });

  it("a no opens a dispute; if the company says nothing for three days the hire is reversed", async () => {
    const { roleId, matchId } = await hired("Engineer, disputed", c, "2026-11-10");
    expect(await w.runJob("role.join_prompt")).toMatchObject({ roles: 1 });
    expect((await w.ceo.req(`/matches/${matchId}/confirm-join`, post())).status).toBe(409); // nothing is disputed yet
    const no = await answer(c, matchId, false);
    expect(no.status).toBe(200);
    expect((await body(no)).application).toMatchObject({ stage: "hired", joinConfirmedAt: null });
    const [item] = await disputes(matchId);
    expect(item).toMatchObject({ refType: "match", payload: { roleId, roleTitle: "Engineer, disputed", candidateId: c.userId, disputedAt: w.t.clock.now().toISOString(), companyConfirmedAt: null } });
    expect(w.subjects(w.ceo)).toContain("Joining disputed: the hire for Engineer, disputed");
    expect((await answer(c, matchId, true)).status).toBe(409); // one answer

    w.t.clock.advance(3 * DAY - MINUTE);
    expect(await w.runJob("role.join_grace")).toMatchObject({ roles: 0 });
    w.t.clock.advance(MINUTE);
    expect(await w.runJob("role.join_grace")).toMatchObject({ roles: 1 });
    expect((await match(matchId)).stage).toBe("did_not_join");
    expect(await w.row(roleId)).toMatchObject({ status: "shortlist_ready", hiredMatchId: null, shortlistReadyAt: w.t.clock.now() });
    expect((await w.events(roleId)).at(-1)).toMatchObject({ fromStatus: "closing", toStatus: "shortlist_ready", actor: "system" });
    expect(await disputes(matchId)).toEqual([]);
  });

  it("a dispute the company contests waits for staff, who can confirm the joining", async () => {
    const { roleId, matchId } = await hired("Engineer, contested", d, "2026-11-12");
    expect(await w.runJob("role.join_prompt")).toMatchObject({ roles: 1 });
    expect((await answer(d, matchId, false)).status).toBe(200);
    expect((await w.rival.req(`/matches/${matchId}/confirm-join`, post())).status).toBe(403);
    expect(await body(await w.ceo.req(`/matches/${matchId}/confirm-join`, post()))).toEqual({ ok: true });
    const [item] = await disputes(matchId);
    expect(item.payload).toMatchObject({ companyConfirmedAt: w.t.clock.now().toISOString(), companyConfirmedBy: w.ceo.userId });

    w.t.clock.advance(8 * DAY); // past both the dispute window and the grace period
    expect(await w.runJob("role.join_grace")).toMatchObject({ roles: 0 });
    expect(await match(matchId)).toMatchObject({ stage: "hired", joinConfirmedAt: null });
    expect((await w.row(roleId)).status).toBe("closing");

    expect((await resolve(w.ceo, item.id, { resolution: "joined" })).status).toBe(403);
    expect((await resolve(w.staff, item.id, { resolution: "accept" })).status).toBe(400);
    expect(await body(await resolve(w.staff, item.id, { resolution: "joined", note: "Offer letter and ID card seen." }))).toEqual({ ok: true, outcome: "joined" });
    expect(await match(matchId)).toMatchObject({ stage: "hired", joinConfirmedAt: w.t.clock.now(), joinConfirmedBy: "staff" });
    expect(await disputes(matchId)).toEqual([]);
    const audit = await w.t.db.select().from(schema.staffAction).where(and(eq(schema.staffAction.refId, matchId), eq(schema.staffAction.action, "join_dispute.joined")));
    expect(audit).toMatchObject([{ actorUserId: w.staff.userId, note: "Offer letter and ID card seen." }]);
    expect(await body(await resolve(w.staff, item.id, { resolution: "did_not_join" }))).toEqual({ ok: true, outcome: "noop" }); // already settled
    expect((await match(matchId)).stage).toBe("hired");
  });

  it("staff can settle a dispute the other way, and a company that agrees closes it by marking did not join", async () => {
    const byStaff = await hired("Engineer, contested again", a, "2026-11-20");
    const byCompany = await hired("Engineer, company agrees", b, "2026-11-20");
    expect(await w.runJob("role.join_prompt")).toMatchObject({ roles: 2 });
    expect((await answer(a, byStaff.matchId, false)).status).toBe(200);
    expect((await answer(b, byCompany.matchId, false)).status).toBe(200);

    await w.ceo.req(`/matches/${byStaff.matchId}/confirm-join`, post());
    const [item] = await disputes(byStaff.matchId);
    expect(await body(await resolve(w.staff, item.id, { resolution: "did_not_join", note: "Candidate shows a competing offer letter." }))).toEqual({ ok: true, outcome: "did_not_join" });
    expect((await match(byStaff.matchId)).stage).toBe("did_not_join");
    expect((await w.events(byStaff.roleId)).at(-1)).toMatchObject({ toStatus: "shortlist_ready", actor: w.staff.userId });
    expect(await disputes(byStaff.matchId)).toEqual([]);

    expect((await w.act(byCompany.matchId, { stage: "did_not_join" })).status).toBe(200);
    expect((await match(byCompany.matchId)).stage).toBe("did_not_join");
    expect(await disputes(byCompany.matchId)).toEqual([]);
    expect((await w.row(byCompany.roleId)).status).toBe("shortlist_ready");
  });
});

describe("leftEarly (§9.2: the fee stands and a replacement role is broadcast)", () => {
  let w: World, a: Seat, b: Seat, c: Seat;
  beforeAll(async () => {
    w = await world();
    [a, b, c] = [await w.candidate("a", 80), await w.candidate("b", 70), await w.candidate("c", 60)];
  });
  afterAll(() => w.t.close());

  it("needs a confirmed joining, creates the replacement in broadcast, and the original still closes on its guarantee", async () => {
    const title = "Engineer, left";
    const first = await w.shortlisted(title, [a]);
    await w.hire(first.match[a.email]!, "2026-11-06");
    const second = await w.shortlisted("Engineer, stayed", [c]);
    await w.hire(second.match[c.email]!, "2026-11-06");
    const matchId = first.match[a.email]!;

    const early = await w.act(matchId, { stage: "left_early" });
    expect(early.status).toBe(409);
    expect((await body(early)).message).toMatch(/not been confirmed/);
    w.t.clock.set("2026-11-06T00:00:00Z");
    expect(await w.runJob("role.join_prompt")).toMatchObject({ roles: 2 });
    for (const [s, id] of [[a, matchId], [c, second.match[c.email]!]] as const) expect((await s.req(`/me/applications/${id}/join`, post({ joined: true }))).status).toBe(200);

    w.t.clock.advance(20 * DAY);
    const res = await w.act(matchId, { stage: "left_early" });
    expect(res.status).toBe(200);
    const out = await body(res);
    expect(out.match.stage).toBe("left_early");
    expect(out.role).toMatchObject({ id: first.id, status: "closing", hiredMatchId: matchId });
    // §5: same content and reach, zero fee, waived deposit, straight into broadcast.
    expect(out.replacement).toMatchObject({ title, status: "broadcast", replacementOfRoleId: first.id, depositMode: "waived", depositAmount: 0,
      feeTerms: { kind: "percent", amount: 0, replacement_guarantee_days: 90 }, campusReach: out.role.campusReach, jd: out.role.jd,
      broadcastOpensAt: w.t.clock.now().toISOString(), broadcastClosesAt: new Date(w.t.clock.now().getTime() + 10 * DAY).toISOString() });
    const replacementId = out.replacement.id as string;
    expect(await w.events(replacementId)).toMatchObject([{ fromStatus: null, toStatus: "broadcast", actor: w.ceo.userId, note: `replacement for role ${first.id}` }]);
    expect(w.subjects(w.ceo)).toContain(`Replacement search started: ${title}`);
    // The broadcast job ran after commit: candidates are scored and nudged again, and can apply.
    expect(await w.stages(replacementId, a, b, c)).toEqual(["scored", "scored", "scored"]);
    expect(w.subjects(b).filter((s) => s === `A role that fits you: ${title}`)).toHaveLength(2);
    expect((await b.req(`/me/roles/${replacementId}/apply`, post())).status).toBe(201);

    // The original: the departure is final, and the role holds until its guarantee ends.
    expect((await w.act(matchId, { stage: "left_early" })).status).toBe(409);
    expect((await w.act(matchId, { stage: "did_not_join" })).status).toBe(409);
    expect(await w.runJob("role.guarantee_expiry")).toMatchObject({ roles: 0 });

    w.t.clock.set("2027-02-05T00:00:01Z"); // 90 days from 6 November ended with 4 February
    await w.relogin(w.staff, w.ceo);
    const late = await w.act(second.match[c.email]!, { stage: "left_early" });
    expect(late.status).toBe(409);
    expect((await body(late)).message).toMatch(/guarantee has ended/);
    expect(await w.runJob("role.guarantee_expiry")).toMatchObject({ roles: 2 });
    expect((await w.row(first.id)).status).toBe("closed");
    expect(await w.stages(first.id, a)).toEqual(["left_early"]);
    expect((await w.row(second.id)).status).toBe("closed");
    expect((await w.row(replacementId)).status).toBe("broadcast"); // untouched by the original's closing
  });
});
