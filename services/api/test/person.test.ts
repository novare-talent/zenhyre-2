// The person columns on user (named as 1.0's profiles named them): filled from sign-up, editable through PATCH /me.
import { describe, expect, it, beforeAll } from "vitest";
import { testApp } from "./helpers";
import { schema } from "@zenhyre/db";

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp();
  await t.db.insert(schema.campus).values({ name: "IIT Bombay", shortCode: "IITB", emailDomains: ["iitb.ac.in"] });
});
const json = (body: unknown, method = "POST"): RequestInit => ({ method, body: JSON.stringify(body) });

describe("person details", () => {
  it("a candidate's sign-up name lands in first_name and last_name", async () => {
    const req = t.as((await t.signIn("asha@iitb.ac.in")).cookie);
    expect((await req("/candidates", json({ name: "Asha Rao Kumar", gradDate: "2027-06-30", course: "B.Tech CSE", rollNumber: null }))).status).toBe(201);
    const me = await (await req("/me")).json() as any;
    expect(me.person).toMatchObject({ firstName: "Asha", lastName: "Rao Kumar", isSubscribed: true });
  });
  it("anyone can edit their own details; links must be http(s)", async () => {
    const req = t.as((await t.signIn("ceo@lab0.ai")).cookie);
    const res = await req("/me", json({ firstName: "Meera", lastName: "Iyer", phone: "+91 98765 43210", linkedinLink: "https://linkedin.com/in/meera", isSubscribed: false }, "PATCH"));
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).person).toMatchObject({ firstName: "Meera", phone: "+91 98765 43210", isSubscribed: false });
    expect((await req("/me", json({ githubLink: "javascript:alert(1)" }, "PATCH"))).status).toBe(400);
    expect((await req("/me", json({ isStaff: true }, "PATCH"))).status).toBe(400);
    expect(((await (await req("/me")).json()) as any).person.firstName).toBe("Meera");
  });
});
