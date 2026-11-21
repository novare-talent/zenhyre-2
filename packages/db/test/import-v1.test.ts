// zenhyre2.import_from_v1 (supabase/import-from-1.0.sql) against a stand-in 1.0 database: dry run, real run, re-run.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { testDb } from "../src/test/setup";
import { schema, Db } from "../src/index";

const file = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
let db: Db, close: (() => Promise<void>) | undefined;
const id = { cand: randomUUID(), cand2: randomUUID(), founder: randomUUID(), hr: randomUUID(), gmailClient: randomUUID(), admin: randomUUID(),
  noAuth: randomUUID(), clash: randomUUID(), taken: randomUUID(), job: randomUUID(), form: randomUUID() };
const rows = async (q: string) => (await db.execute(sql.raw(q))) as unknown as Array<Record<string, any>>;
const run = async (opts = "") => (await rows(`select zenhyre2.import_from_v1(${opts}) as r`))[0]!.r;
const count = async (table: string) => Number((await rows(`select count(*) as n from zenhyre2.${table}`))[0]!.n);
const TABLES = [`"user"`, "user_email", "company", "company_user", "legacy_profile", "legacy_job", "legacy_application", "legacy_record"];

beforeAll(async () => {
  ({ db, close } = await testDb());
  await db.execute(sql.raw(file("./fixtures/v1-public.sql")));
  await db.execute(sql.raw(file("../supabase/import-from-1.0.sql")));
  await db.insert(schema.campus).values({ name: "IIT Bombay", shortCode: "IITB", emailDomains: ["iitb.ac.in"] });
  // Someone already on 2.0 holds taken@x.dev under a different id.
  await db.insert(schema.user).values({ id: id.taken });
  await db.insert(schema.userEmail).values({ userId: id.taken, email: "taken@x.dev", isPrimary: true });
  const people: Array<[string, string, string, string | null, string]> = [
    [id.cand, "Asha@IITB.ac.in", "user", null, "2025-01-01"], [id.cand2, "ravi@gmail.com", "user", null, "2025-01-02"],
    [id.founder, "founder@acme.io", "client", "Acme Labs", "2025-01-03"], [id.hr, "hr@acme.io", "client", null, "2025-02-01"],
    [id.gmailClient, "boss@gmail.com", "client", "Solo Co", "2025-01-04"], [id.admin, "ops@novaretalent.com", "admin", null, "2025-01-05"],
    [id.clash, "taken@x.dev", "user", null, "2025-01-06"]];
  for (const [uid, email, role, companyName, at] of people) {
    await db.execute(sql`insert into auth.users (id, email, email_confirmed_at, created_at) values (${uid}::uuid, ${email}, ${at}::timestamptz, ${at}::timestamptz)`);
    await db.execute(sql`insert into public.profiles (id, email, role, first_name, phone, linkedin_link, company_name, created_at)
      values (${uid}::uuid, ${email}, ${role}, ${"P" + email.slice(0, 3)}, '9876543210', 'https://linkedin.com/in/x', ${companyName}, ${at}::timestamptz)`);
  }
  await db.execute(sql`insert into public.profiles (id, email, role) values (${id.noAuth}::uuid, 'ghost@nowhere.dev', 'user')`);
  await db.execute(sql`insert into public.candidate_resumes (profile_id, resume_path, resume_text) values (${id.cand}::uuid, 'resumes/asha.pdf', 'Asha: Python, Go')`);
  await db.execute(sql`insert into public.subscriptions (id, profile_id, gst_number) values (${randomUUID()}::uuid, ${id.founder}::uuid, '27AAACL1234A1Z5')`);
  await db.execute(sql`insert into public.jobs (job_id, "Job_Name", "Job_Description", "JD_pdf", employer_id, status, "Applied_Candidates", "Shortlisted_Candidates", tags)
    values (${id.job}::uuid, 'Backend intern', 'Build APIs', 'jd/backend.pdf', ${id.founder}::uuid, 'active',
            array[${id.cand}::uuid, ${id.cand2}::uuid], array[${id.cand}::uuid], array['go','python'])`);
  await db.execute(sql`insert into public.forms (form_id, job_id, form) values (${id.form}::uuid, ${id.job}::uuid, '{"q":["Why us?"]}')`);
  await db.execute(sql`insert into public.evaluations (job_id, results) values (${id.job}::uuid, '{"top":["asha"]}')`);
  for (const p of [id.cand, id.cand2]) {
    await db.execute(sql`insert into public.responses (form_id, profile_id, job_id, answers) values (${id.form}::uuid, ${p}::uuid, ${id.job}::uuid, '{"a":"yes"}')`);
  }
  await db.execute(sql`insert into public.onboarding (company_name, ppo_fee_pct, created_by) values ('Acme Labs', 8.33, ${id.founder}::uuid)`);
  await db.execute(sql`insert into public.assignments (job_id, candidate_id, assignment_json) values (${id.job}::uuid, ${id.cand}::uuid, '{}')`);
});
afterAll(() => close?.());

describe("import_from_v1", () => {
  it("a dry run reports and changes nothing", async () => {
    const r = await run();
    expect(r).toMatchObject({ dry_run: true, source_profiles: 8, profiles_without_auth_user: 1, importable: 7, users_created: 6,
      by_role: { user: 3, client: 3, admin: 1 }, with_campus_email: 1, companies_created: 1, company_users_added: 2, legacy_jobs: 1, legacy_applications: 2 });
    expect(r.conflicts).toEqual([{ email: "taken@x.dev", role: "user", reason: "email already held by another 2.0 user" }]);
    expect(r.clients_on_personal_email).toEqual([{ email: "boss@gmail.com", company: "Solo Co" }]);
    expect(await count(`"user"`)).toBe(1);
    expect(await count("legacy_profile")).toBe(0);
    expect(await count("legacy_import_run")).toBe(1);
  });

  it("imports users, emails, companies and the 1.0 history", async () => {
    const r = await run("p_dry_run => false");
    expect(r).toMatchObject({ dry_run: false, users_created: 6, emails_created: 6, companies_created: 1, company_users_added: 2,
      legacy_profiles: 6, legacy_jobs: 1, legacy_applications: 2, legacy_records: { onboarding: 1, subscriptions: 1, assignments: 1 } });
    // Same ids as Supabase Auth, so they sign in with the same account; emails lower-cased and verified as Supabase had them.
    const [asha] = await db.select().from(schema.userEmail).where(sql`email = 'asha@iitb.ac.in'`);
    expect(asha).toMatchObject({ userId: id.cand, isPrimary: true });
    expect(asha!.campusId).not.toBeNull();
    expect(asha!.verifiedAt).toEqual(new Date("2025-01-01T00:00:00Z"));
    // One company for acme.io; the earliest client owns it.
    const [acme] = await db.select().from(schema.company).where(sql`verified_domain = 'acme.io'`);
    expect(acme!.name).toBe("Acme Labs");
    const members = await db.select().from(schema.companyUser).where(sql`company_id = ${acme!.id}`);
    expect(Object.fromEntries(members.map((m) => [m.userId, m.role]))).toEqual({ [id.founder]: "owner", [id.hr]: "member" });
    // Admins are not made staff unless asked; nobody becomes a 2.0 candidate.
    expect((await db.select().from(schema.user).where(sql`id = ${id.admin}`))[0]!.isStaff).toBe(false);
    expect(await count("candidate")).toBe(0);
    // Legacy copies.
    const [lp] = await db.select().from(schema.legacyProfile).where(sql`user_id = ${id.cand}`);
    expect(lp).toMatchObject({ legacyRole: "user", resumeText: "Asha: Python, Go", phone: "9876543210" });
    expect((await db.select().from(schema.legacyProfile).where(sql`user_id = ${id.founder}`))[0]!.gstNumber).toBe("27AAACL1234A1Z5");
    const [job] = await db.select().from(schema.legacyJob);
    expect(job).toMatchObject({ id: id.job, companyId: acme!.id, title: "Backend intern", appliedCount: 2, shortlistedCount: 1, tags: ["go", "python"] });
    expect(job!.forms).toEqual([{ q: ["Why us?"] }]);
    const apps = await db.select().from(schema.legacyApplication);
    expect(apps.find((a) => a.userId === id.cand)!.shortlisted).toBe(true);
    expect(apps.find((a) => a.userId === id.cand2)!.shortlisted).toBe(false);
    // The person columns match 1.0's, and zenhyre2.profiles reads exactly like public.profiles.
    const [founder] = await db.select().from(schema.user).where(sql`id = ${id.founder}`);
    expect(founder).toMatchObject({ firstName: "Pfou", phone: "9876543210", linkedinLink: "https://linkedin.com/in/x" });
    const cols = async (schemaName: string) => (await rows(`select column_name from information_schema.columns
      where table_schema = '${schemaName}' and table_name = 'profiles' order by ordinal_position`)).map((r) => r.column_name);
    expect(await cols("zenhyre2")).toEqual(await cols("public"));
    const view = await rows(`select role, email, company_name from zenhyre2.profiles where id in ('${id.founder}', '${id.cand}', '${id.admin}') order by email`);
    expect(view).toEqual([{ role: "user", email: "asha@iitb.ac.in", company_name: null }, { role: "client", email: "founder@acme.io", company_name: "Acme Labs" },
      // Not staff yet (p_grant_staff was off), so the view shows the 1.0 role.
      { role: "admin", email: "ops@novaretalent.com", company_name: null }]);
    // The person whose address another 2.0 user holds is left out.
    expect(await db.select().from(schema.user).where(sql`id = ${id.clash}`)).toHaveLength(0);
  });

  it("is safe to run again, and 1.0's tables are untouched", async () => {
    const before = await Promise.all(TABLES.map(count));
    const r = await run("p_dry_run => false, p_grant_staff => true");
    expect(r).toMatchObject({ users_created: 0, emails_created: 0, companies_created: 0, company_users_added: 0, staff_granted: 1 });
    expect(await Promise.all(TABLES.map(count))).toEqual(before);
    expect((await db.select().from(schema.user).where(sql`id = ${id.admin}`))[0]!.isStaff).toBe(true);
    expect(Number((await rows("select count(*) as n from public.profiles"))[0]!.n)).toBe(8);
  });
});
