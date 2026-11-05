import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testDb } from "@zenhyre/db/test";
import { createOps } from "../src/index";

let db: any, close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await testDb()));
afterAll(() => close());

describe("review items", () => {
  it("opens, lists by kind, and resolves", async () => {
    const ops = createOps(db);
    const item = await ops.openReview({ kind: "verification", refType: "candidate", refId: "c1", associationId: null, payload: { name: "A" } });
    expect(item.resolvedAt).toBeNull();
    const open = await ops.listReviews({ kind: "verification", open: true });
    expect(open.map((i) => i.id)).toEqual([item.id]);
    await ops.resolveReview(item.id, "staff-1", "approved");
    expect(await ops.listReviews({ kind: "verification", open: true })).toEqual([]);
  });
  it("is idempotent for the same open kind+ref", async () => {
    const ops = createOps(db);
    const a = await ops.openReview({ kind: "alert", refType: "role", refId: "r9", associationId: null, payload: {} });
    const b = await ops.openReview({ kind: "alert", refType: "role", refId: "r9", associationId: null, payload: {} });
    expect(b.id).toBe(a.id);
  });
  it("scopes verification items to an association and ages them into the staff queue", async () => {
    const ops = createOps(db);
    const assoc = "11111111-1111-1111-1111-111111111111";
    await ops.openReview({ kind: "verification", refType: "candidate", refId: "c2", associationId: assoc, payload: {} });
    expect((await ops.listReviews({ kind: "verification", open: true, associationId: assoc })).length).toBe(1);
    expect((await ops.listReviews({ kind: "verification", open: true, staffQueue: true, escapeHatchDays: 7 })).length).toBe(0);
    expect((await ops.listReviews({ kind: "verification", open: true, staffQueue: true, escapeHatchDays: 0 })).length).toBe(1);
  });
  it("records staff actions", async () => {
    const ops = createOps(db);
    await ops.audit("22222222-2222-2222-2222-222222222222", "config.set", "config", "match.broadcast_days", "bumped");
    const rows = await ops.listAudit({ refType: "config" });
    expect(rows[0]!.action).toBe("config.set");
  });
});
