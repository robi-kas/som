import { Prisma } from '@prisma/client';

/**
 * Every kind of cash movement and which way it moves the drawer. One list, used by the
 * drawer close, the X/Z report and the tests, so they can never disagree.
 *
 *   CASH_SALE        customer paid cash
 *   CASH_REFUND      money given back
 *   CASH_DEPOSIT     cash put in (e.g. extra small notes)
 *   CASH_WITHDRAWAL  cash taken out (e.g. paid a supplier)
 *   CHANGE_OUT       cash change for a customer who transferred more than the bill
 *   FLOAT_OUT/IN     (old) waiter change money; the feature was removed, kept only so a
 *                    drawer that already has such movements still adds up
 */
export const CASH_IN = ['CASH_SALE', 'CASH_DEPOSIT', 'FLOAT_IN'] as const;
export const CASH_OUT = ['CASH_REFUND', 'CASH_WITHDRAWAL', 'FLOAT_OUT', 'CHANGE_OUT'] as const;

export function sumMovements(movements: { type: string; amount: Prisma.Decimal }[], type: string) {
  return movements.filter((m) => m.type === type).reduce((acc, m) => acc.add(m.amount), new Prisma.Decimal(0));
}

export function expectedCash(openingFloat: Prisma.Decimal, movements: { type: string; amount: Prisma.Decimal }[]) {
  let total = new Prisma.Decimal(openingFloat);
  for (const t of CASH_IN) total = total.add(sumMovements(movements, t));
  for (const t of CASH_OUT) total = total.sub(sumMovements(movements, t));
  return total;
}
