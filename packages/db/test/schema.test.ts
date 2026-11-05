import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testDb } from "../src/test/setup";
import { schema, Db } from "../src/index";

let db: Db, close: (() => Promise<void>) | undefined;
beforeAll(async () => ({ db, close } = await testDb()));
afterAll(() => close?.());

describe("schema", () => {
  it("inserts a campus and a user with an email", async () => {
    const [c] = await db.insert(schema.campus).values({ name: "IIT Bombay", shortCode: "IITB", emailDomains: ["iitb.ac.in"] }).returning();
    const [u] = await db.insert(schema.user).values({}).returning();
    await db.insert(schema.userEmail).values({ userId: u!.id, email: "a@iitb.ac.in", campusId: c!.id });
    const rows = await db.select().from(schema.userEmail);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.campusId).toBe(c!.id);
  });
});
