import { describe, it, expect } from "vitest";
import { rupees, formatPaise, percentOf } from "../src/money";

describe("money", () => {
  it("converts rupees to paise", () => {
    expect(rupees(15000)).toBe(1500000);
  });
  it("formats paise as ₹ with Indian grouping", () => {
    expect(formatPaise(1500000)).toBe("₹15,000");
    expect(formatPaise(120000000)).toBe("₹12,00,000");
  });
  it("takes a percentage and rounds to the nearest paisa", () => {
    expect(percentOf(120000000, 0.1)).toBe(12000000);
    expect(percentOf(333, 0.1)).toBe(33);
  });
});
