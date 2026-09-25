import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { expectedCash } from './cash-math.js';

const D = (v: number) => new Prisma.Decimal(v);
const m = (type: string, amount: number) => ({ type, amount: D(amount) });

describe('drawer math', () => {
  it('opening + sales − refunds + added − taken out − change for transfers', () => {
    // 1000 + 300 − 50 + 200 − 100 − 20 = 1330
    const total = expectedCash(D(1000), [m('CASH_SALE', 300), m('CASH_REFUND', 50), m('CASH_DEPOSIT', 200), m('CASH_WITHDRAWAL', 100), m('CHANGE_OUT', 20)]);
    expect(total.toFixed(2)).toBe('1330.00');
  });
});
