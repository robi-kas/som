import Decimal from "decimal.js";
import { Money } from "./money";

export type RoundingMode = "HALF_UP" | "HALF_EVEN" | "FLOOR" | "CEIL";

export function roundMoney(money: Money, decimalPlaces = 2, mode: RoundingMode = "HALF_UP"): Money {
  const decimalMode = {
    HALF_UP: Decimal.ROUND_HALF_UP,
    HALF_EVEN: Decimal.ROUND_HALF_EVEN,
    FLOOR: Decimal.ROUND_FLOOR,
    CEIL: Decimal.ROUND_CEIL,
  }[mode];
  return new Money(money.amount.toDecimalPlaces(decimalPlaces, decimalMode), money.currency);
}
