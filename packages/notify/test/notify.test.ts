import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { testDb } from "@zenhyre/db/test";
import { schema } from "@zenhyre/db";
import { createNotify, MemoryTransport, ConsoleTransport } from "../src/index";

let db: any, close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await testDb()));
afterAll(() => close());

async function userWithEmails(emails: string[]) {
  const [u] = await db.insert(schema.user).values({}).returning();
  for (const [i, e] of emails.entries())
    await db.insert(schema.userEmail).values({ userId: u.id, email: e, verifiedAt: new Date(), isPrimary: i === 0 });
  return u.id;
}

describe("notify", () => {
  it("sends email to the primary address and records in-app + email rows", async () => {
    const t = new MemoryTransport();
    const notify = createNotify(db, t);
    const uid = await userWithEmails(["p@iitb.ac.in", "q@gmail.com"]);
    await notify.send(uid, "add_personal_email", {});
    expect(t.sent[0]!.to).toBe("p@iitb.ac.in");
    expect(t.sent[0]!.subject).toMatch(/personal email/i);
    const rows = await db.select().from(schema.notification);
    expect(rows.map((r: any) => r.channel).sort()).toEqual(["email", "in_app"]);
  });
  it("sends a template to a bare address with no user (magic links, invites)", async () => {
    const t = new MemoryTransport();
    const notify = createNotify(db, t);
    await notify.sendToEmail("nobody-yet@gmail.com", "magic_link", { url: "http://x/redeem?t=1" });
    expect(t.sent.at(-1)!.to).toBe("nobody-yet@gmail.com");
    expect(t.sent.at(-1)!.subject).toMatch(/sign in/i);
  });
  it("falls back to the next verified email after a bounce and reports undeliverable when all have bounced", async () => {
    const t = new MemoryTransport();
    const notify = createNotify(db, t);
    const uid = await userWithEmails(["dead@iitb.ac.in", "alive@gmail.com"]);
    await notify.recordBounce("dead@iitb.ac.in", "hard bounce");
    await notify.send(uid, "add_personal_email", {});
    expect(t.sent.at(-1)!.to).toBe("alive@gmail.com");
    await notify.recordBounce("alive@gmail.com", "hard bounce");
    const r = await notify.send(uid, "add_personal_email", {});
    expect(r.email).toBe("undeliverable");
  });
  it("does not send email for in-app-only templates", async () => {
    const t = new MemoryTransport();
    const notify = createNotify(db, t);
    const uid = await userWithEmails(["a@iitb.ac.in"]);
    const before = t.sent.length;
    await notify.send(uid, "application_received", { roleTitle: "SDE" });
    expect(t.sent.length).toBe(before);
  });
  it("console transport prints the email, link included, instead of sending it", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const notify = createNotify(db, new ConsoleTransport());
      await notify.sendToEmail("dev@iitb.ac.in", "magic_link", { url: "http://localhost:4000/auth/redeem?t=abc" });
      const printed = log.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(printed).toContain("dev@iitb.ac.in");
      expect(printed).toContain("http://localhost:4000/auth/redeem?t=abc");
    } finally {
      log.mockRestore();
    }
  });
});
