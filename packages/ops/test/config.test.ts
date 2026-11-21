import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testDb } from "@zenhyre/db/test";
import { createOps, CONFIG } from "../src/index";

let db: any, close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await testDb()));
afterAll(() => close());

describe("config", () => {
  it("returns spec defaults when nothing is stored", async () => {
    const ops = createOps(db);
    expect(await ops.config.get("match.broadcast_days")).toBe(10);
    expect(await ops.config.get("deposit.tiers")).toEqual([
      { max_campuses: 5, amount: 1500000 },
      { max_campuses: 12, amount: 3000000 },
      { max_campuses: 23, amount: 6000000 },
    ]);
  });
  it("stores an override and reads it back", async () => {
    const ops = createOps(db);
    await ops.config.set("match.broadcast_days", 14, "staff-1");
    expect(await ops.config.get("match.broadcast_days")).toBe(14);
  });
  it("rejects a value that fails the key's schema", async () => {
    const ops = createOps(db);
    await expect(ops.config.set("match.broadcast_days", "soon" as any, "staff-1")).rejects.toThrow(/invalid/i);
  });
});

describe("deposit.ctc_slabs reference", () => {
  const LPA = 100_000 * 100;
  const slabs = CONFIG["deposit.ctc_slabs"].default;
  const at = (lpa: number) => slabs.find((s) => lpa * LPA >= s.ctc_from && (s.ctc_to === null || lpa * LPA < s.ctc_to))!.amount;
  it("₹20 LPA → ₹20,000, from a ₹5,000 base up to ₹2,00,000 at ₹2 Cr, contiguous", () => {
    expect([5, 20, 35, 100, 200, 500].map(at)).toEqual([500_000, 2_000_000, 3_000_000, 10_000_000, 20_000_000, 20_000_000]);
    for (let i = 1; i < slabs.length; i++) expect(slabs[i]!.ctc_from).toBe(slabs[i - 1]!.ctc_to);
  });
});
