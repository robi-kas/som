import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Concurrency helpers.
 *
 * Postgres runs each request's transaction at READ COMMITTED. Two cashiers paying the same
 * bill at the same moment would both read "balance 500", both pass the check, and both
 * insert a payment. Locking the order row first makes the second transaction wait until the
 * first commits, so it re-reads the real balance.
 */

/** SELECT ... FOR UPDATE on one order row. Call first thing inside the transaction. */
export async function lockOrderRow(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
  if (rows.length === 0) throw new NotFoundException('Order not found');
}

/** SELECT ... FOR UPDATE on one shift row (cash drawer totals). */
export async function lockShiftRow(tx: Prisma.TransactionClient, shiftId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "CashierShift" WHERE "id" = ${shiftId} FOR UPDATE`;
}

/**
 * Atomically increments a per-branch counter and returns the new value.
 * Replaces "count today's orders + 1", which produced duplicates under load.
 */
export async function nextBranchCounter(tx: Prisma.TransactionClient, branchId: string, scope: string): Promise<number> {
  const rows = await tx.$queryRaw<{ lastValue: number }[]>`
    INSERT INTO "BranchCounter" ("branchId", "scope", "lastValue")
    VALUES (${branchId}, ${scope}, 1)
    ON CONFLICT ("branchId", "scope")
    DO UPDATE SET "lastValue" = "BranchCounter"."lastValue" + 1
    RETURNING "lastValue"`;
  return Number(rows[0].lastValue);
}

/** Business day key in the cafe's timezone (Africa/Addis_Ababa by default), e.g. "20260925". */
export function businessDayKey(date = new Date(), timeZone = process.env.BUSINESS_TIMEZONE ?? 'Africa/Addis_Ababa'): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  return parts.replace(/-/g, '');
}
