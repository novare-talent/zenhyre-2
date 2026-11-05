import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { schema } from "@zenhyre/db";
import { testApp } from "./helpers";

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => (t = await testApp()));
afterAll(() => t.close());

describe("resend bounce webhook", () => {
  it("is reachable without a session, ignores unknown addresses, and alerts when a user has no deliverable email", async () => {
    const post = (to: string) => t.app.request("/webhooks/resend", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "email.bounced", data: { to: [to], bounce: { message: "hard" } } }) });
    expect((await post("ghost@nowhere.io")).status).toBe(200);
    const { json } = await t.signIn("only@gmail.com");
    expect((await post("only@gmail.com")).status).toBe(200);
    const alerts = (await t.db.select().from(schema.reviewItem)).filter((i) => i.kind === "alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.refId).toBe(json.userId);
  });
});
