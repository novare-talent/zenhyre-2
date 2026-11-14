// A small world for workflow tests: a fresh database with one campus, staff, a company, and helpers that walk a role
// to a given point through the real routes.
import { expect } from "vitest";
import { asc, eq } from "@zenhyre/db/orm";
import { schema } from "@zenhyre/db";
import { fixtureGateModel, type GateRole } from "@zenhyre/gate";
import { fixedScorer } from "@zenhyre/matching";
import { testApp } from "./helpers";

export const DAY = 24 * 60 * 60 * 1000, MINUTE = 60 * 1000;
export const L = (lakhs: number) => lakhs * 100_000 * 100;
export const post = (body?: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body ?? {}) });
export const body = async (res: Response) => (await res.json()) as any;
const good = { type: "fresher", jd: "You will build and run the services behind our booking product. ".repeat(4),
  ctcMin: L(12), ctcMax: L(16), yearsExpMin: 0, yearsExpMax: 1, locations: ["Bengaluru"], campusReach: ["IITB"] };

type Req = ReturnType<Awaited<ReturnType<typeof testApp>>["as"]>;
export interface Seat { email: string; userId: string; req: Req }
type Before = "draft" | "gated" | "rejected" | "terms_pending" | "terms_released" | "deposit_pending" | "broadcast";

/** A fresh database with one campus, a staff seat, a company and its rival. Each describe gets its own, so one block's clock cannot age another's roles. */
export async function world() {
  const scores: Record<string, number> = {};
  let borderline = false;
  const t = await testApp("2026-11-05T10:00:00Z", {
    scorer: fixedScorer(scores),
    gateModel: fixtureGateModel((r: GateRole) => ({ score: borderline ? 55 : 85, suggested_reach: r.campusReach, concerns: [], reason: borderline ? "Borderline." : "A good fit." })),
  });
  await t.db.insert(schema.campus).values({ name: "IIT Bombay", shortCode: "IITB", emailDomains: ["iitb.ac.in"] });

  const seat = async (email: string): Promise<Seat> => {
    const s = await t.signIn(email);
    return { email, userId: s.json.userId, req: t.as(s.cookie) };
  };
  /** Sessions last 30 days: sign in again after moving the clock a long way. */
  const relogin = async (...seats: Seat[]) => { for (const s of seats) s.req = (await seat(s.email)).req; };

  const staff = await seat("ops@novaretalent.com");
  await t.db.update(schema.user).set({ isStaff: true }).where(eq(schema.user.id, staff.userId));
  const ceo = await seat("ceo@lab0.ai");
  const companyId = (await body(await ceo.req("/companies", post({ name: "Lab0" })))).company.id as string;
  const rival = await seat("founder@rival.io");
  const rivalCompanyId = (await body(await rival.req("/companies", post({ name: "Rival" })))).company.id as string;

  /** A final-year IIT Bombay candidate with a fixed fit score, so shortlist order is known. */
  async function candidate(name: string, score: number): Promise<Seat> {
    const s = await seat(`${name}@iitb.ac.in`);
    expect((await s.req("/candidates", post({ gradDate: "2027-06-30", course: "B.Tech CSE", rollNumber: null }))).status).toBe(201);
    scores[s.userId] = score;
    return s;
  }

  /** Creates a role as the company and walks it to `status` through the real routes. */
  async function roleAt(status: Before, title: string): Promise<string> {
    const created = await ceo.req(`/companies/${companyId}/roles`, post({ ...good, title, ...(status === "rejected" ? { jd: "Too short." } : {}) }));
    expect(created.status).toBe(201);
    const id = (await body(created)).role.id as string;
    if (status === "draft") return id;
    borderline = status === "gated"; // a borderline score waits for a person, so the role stays `gated`
    const submitted = await ceo.req(`/roles/${id}/submit`, post());
    borderline = false;
    expect(submitted.status).toBe(200);
    if (status === "gated" || status === "rejected" || status === "terms_pending") return id;
    expect((await staff.req(`/admin/roles/${id}/release-terms`, post())).status).toBe(200);
    if (status === "terms_released") return id;
    expect((await ceo.req(`/roles/${id}/terms/accept`, post())).status).toBe(200);
    if (status === "deposit_pending") return id;
    expect((await staff.req(`/admin/roles/${id}/waive-deposit`, post({ note: "Pilot customer." }))).status).toBe(200);
    return id;
  }
  /** A role in `shortlist_ready` with `applicants` on its shortlist; returns each one's match id, by email. */
  async function shortlisted(title: string, applicants: Seat[]) {
    const id = await roleAt("broadcast", title);
    const match: Record<string, string> = {};
    for (const s of applicants) {
      const res = await s.req(`/me/roles/${id}/apply`, post());
      expect(res.status).toBe(201);
      match[s.email] = (await body(res)).application.id;
    }
    expect((await staff.req(`/admin/roles/${id}/close-broadcast`, post({ note: "Company asked to move early." }))).status).toBe(200);
    return { id, match };
  }
  const act = (matchId: string, payload: Record<string, unknown>) => ceo.req(`/matches/${matchId}/actions`, post(payload));
  /** Takes a shortlisted match all the way to `hired`. */
  async function hire(matchId: string, joinedOn: string) {
    for (const step of [{ stage: "viewed" }, { stage: "interviewed" }, { stage: "offered", offeredCtc: L(14) }, { stage: "offer_accepted" },
      { stage: "hired", hiredCtc: L(14), joinedOn }]) {
      expect((await act(matchId, step)).status, step.stage).toBe(200);
    }
  }

  const row = async (roleId: string) => (await t.db.select().from(schema.role).where(eq(schema.role.id, roleId)))[0]!;
  const events = (roleId: string) => t.db.select().from(schema.roleEvent).where(eq(schema.roleEvent.roleId, roleId)).orderBy(asc(schema.roleEvent.seq));
  /** candidate user id → their match on the role. */
  const matches = async (roleId: string) => new Map((await t.db.select().from(schema.match).where(eq(schema.match.roleId, roleId))).map((m) => [m.candidateId, m]));
  const stages = async (roleId: string, ...seats: Seat[]) => { const all = await matches(roleId); return seats.map((s) => all.get(s.userId)?.stage); };
  const subjects = (s: Seat) => t.transport.sent.filter((m) => m.to === s.email).map((m) => m.subject);
  /** How many times a candidate was told the role closed. */
  const toldClosed = (s: Seat, title: string) => t.transport.sent.filter((m) => m.to === s.email && m.subject === `Update on ${title}` && m.text === "Status: role_closed").length;
  const runJob = async (name: string) => { const res = await staff.req(`/admin/jobs/${name}/run`, post()); expect(res.status).toBe(200); return body(res); };
  const withdraw = (who: Seat, roleId: string, note?: string) => who.req(`/roles/${roleId}/withdraw`, post(note === undefined ? {} : { note }));

  return { t, staff, ceo, rival, companyId, rivalCompanyId, seat, relogin, candidate, roleAt, shortlisted, act, hire, row, events, matches, stages, subjects, toldClosed, runJob, withdraw };
}
export type World = Awaited<ReturnType<typeof world>>;
