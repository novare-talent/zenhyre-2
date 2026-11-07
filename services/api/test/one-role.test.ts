import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@zenhyre/db";
import { testApp } from "./helpers";

let t: Awaited<ReturnType<typeof testApp>>;
const post = (cookie: string, path: string, body: unknown) => t.as(cookie)(path, { method: "POST", body: JSON.stringify(body) });
const alum = { name: "Test Alum", campusShortCode: "IITB", gradDate: "2018-06-30", course: "B.Tech", claimed: { batch: "2018", branch: "EE", linkedinUrl: "" } };
async function staff() {
  const s = await t.signIn("ops@novaretalent.com");
  await t.db.update(schema.user).set({ isStaff: true }).where(eq(schema.user.id, s.json.userId));
  return s.cookie;
}

beforeAll(async () => {
  t = await testApp();
  await t.db.insert(schema.campus).values([
    { name: "IIT Bombay", shortCode: "IITB", emailDomains: ["iitb.ac.in"], rollNumberRegex: null, internalTier: 1 },
    { name: "IIT Delhi", shortCode: "IITD", emailDomains: ["iitd.ac.in"], rollNumberRegex: null, internalTier: 1 },
  ]);
});
afterAll(() => t.close());

describe("who may log in as what", () => {
  it("candidates use a campus LDAP address or a personal mailbox, never a work address", async () => {
    const ldap = await t.signIn("190050001@iitb.ac.in");
    expect((await post(ldap.cookie, "/candidates", { name: "LDAP Student", gradDate: "2027-05-01", course: "B.Tech CS", rollNumber: "190050001" })).status).toBe(201);
    const personal = await t.signIn("someone@gmail.com");
    expect((await post(personal.cookie, "/candidates", alum)).status).toBe(201);
    const work = await t.signIn("someone@bigco.com");
    const refused = await post(work.cookie, "/candidates", alum);
    expect(refused.status).toBe(400);
    expect((await refused.json() as any).message).toMatch(/personal email|LDAP/i);
  });
  it("companies use a work address, never a personal mailbox or a campus address", async () => {
    for (const email of ["founder@yahoo.co.in", "founder@outlook.com", "prof@iitd.ac.in"]) {
      const s = await t.signIn(email);
      expect((await post(s.cookie, "/companies", { name: "X" })).status, email).toBe(400);
    }
    const ok = await t.signIn("founder@kiln.studio");
    expect((await post(ok.cookie, "/companies", { name: "Kiln" })).status).toBe(201);
  });
});

describe("one email, one role", () => {
  it("a candidate cannot also create a company, and a company user cannot also become a candidate", async () => {
    const cand = await t.signIn("both@gmail.com");
    await post(cand.cookie, "/candidates", alum);
    const asCompany = await post(cand.cookie, "/companies", { name: "Side project" });
    expect(asCompany.status).toBe(409);
    expect((await asCompany.json() as any).error).toBe("role_taken");

    const owner = await t.signIn("ceo@acme.io");
    await post(owner.cookie, "/companies", { name: "Acme" });
    expect((await post(owner.cookie, "/candidates", alum)).status).toBe(409);
  });
  it("association logins are created by staff, work at first sign-in, and exclude every other role", async () => {
    const cookie = await staff();
    const created = await post(cookie, "/admin/associations", { campusShortCode: "IITD", name: "IITD alumni", payoutMode: "cash", adminEmails: ["sec@iitd-alumni.org"] });
    expect(created.status).toBe(201);
    expect(t.transport.sent.at(-1)!.text).toMatch(/\/login\?as=association/);
    const admin = await t.signIn("sec@iitd-alumni.org"); // an ordinary sign-in link is all they need
    const me = await (await t.as(admin.cookie)("/me")).json() as any;
    expect(me.associations.map((a: any) => a.name)).toEqual(["IITD alumni"]);
    expect(me.emails[0].verified).toBe(true);
    expect((await post(admin.cookie, "/candidates", alum)).status).toBe(409);
    expect((await post(admin.cookie, "/companies", { name: "X" })).status).toBe(409);
  });
  it("staff cannot hand an association login to an address that is already a candidate", async () => {
    const cookie = await staff();
    const res = await post(cookie, "/admin/associations", { campusShortCode: "IITB", name: "IITB alumni", payoutMode: "cash", adminEmails: ["both@gmail.com"] });
    expect(res.status).toBe(409);
    expect(await t.db.select().from(schema.association).where(eq(schema.association.name, "IITB alumni"))).toHaveLength(0);
  });
  it("a company invite cannot be issued to an address that is already a candidate", async () => {
    const owner = await t.signIn("cto@globex.dev");
    const { company } = await (await post(owner.cookie, "/companies", { name: "Globex" })).json() as any;
    // staff may invite across domains, so only the one-role rule can stop this
    const clash = await post(await staff(), `/companies/${company.id}/invites`, { email: "both@gmail.com" });
    expect(clash.status).toBe(409);
    expect((await clash.json() as any).error).toBe("role_taken");
  });
});
