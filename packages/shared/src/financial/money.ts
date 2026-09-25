import Decimal from "decimal.js";

export type DecimalInput = string | Decimal | number;

export class Money {
  readonly amount: Decimal;
  readonly currency: string;

  constructor(amount: DecimalInput, currency = "ETB") {
    const value = new Decimal(amount);
    if (!value.isFinite()) throw new Error("Money amount must be finite");
    if (value.isNegative()) throw new Error("Money amount cannot be negative");
    if (!currency || currency.length !== 3) throw new Error("Currency must be a three-letter code");
    
    this.amount = value;
    this.currency = currency;
  }

  static fromString(amount: string, currency = "ETB"): Money { return new Money(amount, currency); }
  
  assertSameCurrency(other: Money) {
    if (this.currency !== other.currency) throw new Error(`Currency mismatch: ${this.currency} vs ${other.currency}`);
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount.plus(other.amount), this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    const result = this.amount.minus(other.amount);
    if (result.isNegative()) throw new Error("Resulting money cannot be negative");
    return new Money(result, this.currency);
  }
}
