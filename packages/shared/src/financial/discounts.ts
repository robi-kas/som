import { Money, DecimalInput } from "./money";
import Decimal from "decimal.js";
import { roundMoney } from "./rounding";

export type DiscountType = "PERCENTAGE" | "FIXED_AMOUNT";

export function calculateDiscount(subtotal: Money, type: DiscountType, value: DecimalInput): Money {
  const val = new Decimal(value);
  
  if (type === "FIXED_AMOUNT") {
    if (val.greaterThan(subtotal.amount)) throw new Error("Discount exceeds eligible amount");
    return new Money(val, subtotal.currency);
  }
  
  if (type === "PERCENTAGE") {
    if (val.lessThan(0) || val.greaterThan(100)) throw new Error("Invalid percentage");
    const amount = subtotal.amount.times(val).dividedBy(100);
    return roundMoney(new Money(amount, subtotal.currency));
  }
  
  return new Money(0, subtotal.currency);
}
