import { describe, expect, it } from "vitest";
import { decideSeat } from "../src/lib/seat-decision";

describe("decideSeat: one email, one role", () => {
  it("seats a person in the role they chose when they hold it", () => {
    expect(decideSeat("company", ["company"])).toEqual({ kind: "seat", seat: "company", notice: false });
  });
  it("sends a brand-new candidate or company to first-time setup", () => {
    expect(decideSeat("candidate", [])).toEqual({ kind: "setup", seat: "candidate" });
    expect(decideSeat("company", [])).toEqual({ kind: "setup", seat: "company" });
  });
  it("refuses the association seat to an address Novare has not issued access to", () => {
    expect(decideSeat("association", [])).toEqual({ kind: "refuse" });
  });
  it("keeps an email in the role it already holds, and says so", () => {
    expect(decideSeat("company", ["candidate"])).toEqual({ kind: "seat", seat: "candidate", notice: true });
    expect(decideSeat("association", ["company"])).toEqual({ kind: "seat", seat: "company", notice: true });
  });
  it("never lets a candidate or company into the association seat by asking for it", () => {
    for (const held of [["candidate"], ["company"]] as const) expect(decideSeat("association", [...held])).not.toMatchObject({ seat: "association" });
  });
  it("seats an invited association admin", () => {
    expect(decideSeat("association", ["association"])).toEqual({ kind: "seat", seat: "association", notice: false });
  });
  it("copes with a link opened on another device, where the chosen role is unknown", () => {
    expect(decideSeat(null, ["candidate"])).toEqual({ kind: "seat", seat: "candidate", notice: false });
    expect(decideSeat(null, [])).toEqual({ kind: "setup", seat: null });
  });
});
