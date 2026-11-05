import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testDb } from "@zenhyre/db/test";
import { createOps } from "../src/index";

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
