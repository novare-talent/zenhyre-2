import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testApp } from "./helpers";

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => (t = await testApp()));
afterAll(() => t.close());

describe("company sign-up and invites", () => {
  it("creates a company and invites a teammate who lands as member", async () => {
    const { cookie } = await t.signIn("ceo@lab0.ai");
    const res = await t.as(cookie)("/companies", { method: "POST", body: JSON.stringify({ name: "Lab0" }) });
    expect(res.status).toBe(201);
    const { company } = await res.json() as any;
    const inv = await t.as(cookie)(`/companies/${company.id}/invites`, { method: "POST", body: JSON.stringify({ email: "cto@lab0.ai" }) });
    expect(inv.status).toBe(200);
    expect(t.transport.sent.at(-1)!.to).toBe("cto@lab0.ai");
    const url = new URL(t.transport.sent.at(-1)!.text.match(/https?:\/\/\S+/)![0]);
    const red = await t.app.request(url.pathname + url.search);
    const cookie2 = red.headers.get("set-cookie")!.split(";")[0]!;
    const me = await (await t.as(cookie2)("/me")).json() as any;
    expect(me.membership.companyId).toBe(company.id);
    expect(me.membership.role).toBe("member");
  });
  it("refuses gmail for company sign-up", async () => {
    const { cookie } = await t.signIn("founder@gmail.com");
    const res = await t.as(cookie)("/companies", { method: "POST", body: JSON.stringify({ name: "X" }) });
    expect(res.status).toBe(400);
  });
});
