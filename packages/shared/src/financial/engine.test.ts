import { describe, it, expect } from "vitest";
import { Money } from "./money";
import { roundMoney } from "./rounding";
import { calculateDiscount } from "./discounts";
import { calculateTaxExclusive, calculateTaxInclusive } from "./tax";
import { calculatePayment } from "./payments";

describe("Money Core", () => {
  it("rejects negative money", () => {
    expect(() => new Money("-10.50")).toThrow("Money amount cannot be negative");
  });
  it("rejects invalid currencies", () => {
    expect(() => new Money("10.50", "US")).toThrow("Currency must be a three-letter code");
  });
  it("rejects currency mismatch on addition", () => {
    const a = new Money("10", "ETB");
    const b = new Money("10", "USD");
    expect(() => a.add(b)).toThrow("Currency mismatch");
  });
  it("prevents subtraction that results in negative money", () => {
    const a = new Money("10");
    const b = new Money("15");
    expect(() => a.subtract(b)).toThrow("Resulting money cannot be negative");
  });
});

describe("Rounding Policy", () => {
  it("rounds HALF_UP", () => {
    const m = new Money("10.125");
    expect(roundMoney(m, 2, "HALF_UP").amount.toString()).toBe("10.13");
  });
  it("rounds HALF_EVEN", () => {
    const m = new Money("10.125");
    expect(roundMoney(m, 2, "HALF_EVEN").amount.toString()).toBe("10.12");
  });
});

describe("Discounts", () => {
  it("throws when fixed discount exceeds subtotal", () => {
    const subtotal = new Money("100");
    expect(() => calculateDiscount(subtotal, "FIXED_AMOUNT", "101")).toThrow("Discount exceeds eligible amount");
  });
  it("calculates 100% discount", () => {
    const subtotal = new Money("100");
    expect(calculateDiscount(subtotal, "PERCENTAGE", "100").amount.toString()).toBe("100");
  });
  it("calculates 0% discount", () => {
    const subtotal = new Money("100");
    expect(calculateDiscount(subtotal, "PERCENTAGE", "0").amount.toString()).toBe("0");
  });
  it("throws on invalid percentages", () => {
    const subtotal = new Money("100");
    expect(() => calculateDiscount(subtotal, "PERCENTAGE", "-5")).toThrow("Invalid percentage");
    expect(() => calculateDiscount(subtotal, "PERCENTAGE", "105")).toThrow("Invalid percentage");
  });
});

describe("Tax Calculations", () => {
  it("throws on negative tax rate", () => {
    expect(() => calculateTaxExclusive(new Money("100"), "-5")).toThrow("Tax rate cannot be negative");
  });
  it("calculates inclusive tax with awkward decimals", () => {
    const total = new Money("11.11"); // Includes 15% tax
    // Base = 11.11 / 1.15 = 9.660869... Tax = 1.44913...
    // Rounded HALF_UP = 1.45
    expect(calculateTaxInclusive(total, "15").amount.toString()).toBe("1.45");
  });
});

describe("Payments", () => {
  it("throws if previously paid exceeds total", () => {
    const total = new Money("100");
    const prev = new Money("150");
    const tendered = new Money("50");
    expect(() => calculatePayment(total, prev, tendered)).toThrow("Previously paid amount exceeds order total");
  });
  it("handles exact split payments", () => {
    const total = new Money("100");
    const prev = new Money("40");
    const tendered = new Money("60");
    const calc = calculatePayment(total, prev, tendered);
    expect(calc.appliedAmount.amount.toString()).toBe("60");
    expect(calc.changeAmount.amount.toString()).toBe("0");
    expect(calc.remainingBalance.amount.toString()).toBe("0");
  });
  it("handles payment exceeding remaining balance", () => {
    const total = new Money("100");
    const prev = new Money("40");
    const tendered = new Money("100");
    const calc = calculatePayment(total, prev, tendered);
    expect(calc.appliedAmount.amount.toString()).toBe("60");
    expect(calc.changeAmount.amount.toString()).toBe("40");
    expect(calc.remainingBalance.amount.toString()).toBe("0");
  });
});
