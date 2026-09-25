import { Money, DecimalInput } from "./money";
import Decimal from "decimal.js";
import { roundMoney } from "./rounding";

export function calculateTaxExclusive(taxableAmount: Money, ratePercent: DecimalInput): Money {
  const rate = new Decimal(ratePercent);
  if (rate.isNegative()) throw new Error("Tax rate cannot be negative");
  const amount = taxableAmount.amount.times(rate).dividedBy(100);
  return roundMoney(new Money(amount, taxableAmount.currency));
}

export function calculateTaxInclusive(totalAmount: Money, ratePercent: DecimalInput): Money {
  const rate = new Decimal(ratePercent);
  if (rate.isNegative()) throw new Error("Tax rate cannot be negative");
  const base = totalAmount.amount.dividedBy(new Decimal(1).plus(rate.dividedBy(100)));
  const taxAmount = totalAmount.amount.minus(base);
  return roundMoney(new Money(taxAmount, totalAmount.currency));
}
