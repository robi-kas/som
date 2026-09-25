import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { computeOrderTotals, parseMoney, roundMoney, type PricingConfig } from './pricing.js';

const D = (v: string | number) => new Prisma.Decimal(v);
const exclusive: PricingConfig = { taxRatePercent: D(15), isTaxInclusive: false, serviceChargePercent: D(10), roundingMode: 'HALF_UP' };

const line = (price: string, qty: number, mods: string[] = []) => ({ unitPrice: D(price), quantity: qty, modifierDeltas: mods.map(D) });

describe('computeOrderTotals', () => {
  it('matches the blueprint example bill (VAT on subtotal + service)', () => {
    // 2 × Cheeseburger 200, 1 × Fries 90, 2 × Macchiato 55, 1 × Juice 70 = 670
    const t = computeOrderTotals([line('200', 2), line('90', 1), line('55', 2), line('70', 1)], exclusive);
    expect(t.subtotal.toFixed(2)).toBe('670.00');
    expect(t.serviceChargeAmount.toFixed(2)).toBe('67.00');
    expect(t.taxAmount.toFixed(2)).toBe('110.55');
    expect(t.totalAmount.toFixed(2)).toBe('847.55');
  });

  it('adds modifier prices to the unit price', () => {
    const t = computeOrderTotals([line('55', 2, ['20', '15'])], { ...exclusive, serviceChargePercent: D(0), taxRatePercent: D(0) });
    expect(t.subtotal.toFixed(2)).toBe('180.00');
  });

  it('rounds every component to the santim', () => {
    const t = computeOrderTotals([line('33.33', 1)], exclusive);
    expect(t.serviceChargeAmount.toFixed(2)).toBe('3.33');
    expect(t.taxAmount.decimalPlaces()).toBeLessThanOrEqual(2);
    expect(t.totalAmount.equals(t.subtotal.add(t.serviceChargeAmount).add(t.taxAmount))).toBe(true);
  });

  it('applies percent discounts before service and VAT', () => {
    const t = computeOrderTotals([line('100', 1)], exclusive, { type: 'PERCENT', value: D(10) });
    expect(t.discountAmount.toFixed(2)).toBe('10.00');
    expect(t.serviceChargeAmount.toFixed(2)).toBe('9.00');
    expect(t.taxAmount.toFixed(2)).toBe('14.85');
    expect(t.totalAmount.toFixed(2)).toBe('113.85');
  });

  it('caps a fixed discount at the subtotal', () => {
    const t = computeOrderTotals([line('50', 1)], exclusive, { type: 'FIXED', value: D(80) });
    expect(t.discountAmount.toFixed(2)).toBe('50.00');
    expect(t.totalAmount.toFixed(2)).toBe('0.00');
  });

  it('extracts VAT from tax-inclusive prices without changing the total', () => {
    const t = computeOrderTotals([line('115', 1)], { ...exclusive, isTaxInclusive: true, serviceChargePercent: D(0) });
    expect(t.totalAmount.toFixed(2)).toBe('115.00');
    expect(t.taxAmount.toFixed(2)).toBe('15.00');
  });

  it('handles an empty order', () => {
    const t = computeOrderTotals([], exclusive);
    expect(t.totalAmount.toFixed(2)).toBe('0.00');
  });
});

describe('parseMoney', () => {
  it('accepts plain 2dp amounts', () => {
    expect(parseMoney('12.5').toFixed(2)).toBe('12.50');
    expect(parseMoney(100).toFixed(2)).toBe('100.00');
  });
  it.each(['-1', '1.234', 'abc', '', '1e5', '0x10'])('rejects %s', (v) => {
    expect(() => parseMoney(v)).toThrow();
  });
});

describe('roundMoney', () => {
  it('honours the rounding mode', () => {
    expect(roundMoney(D('2.345'), 'HALF_UP').toFixed(2)).toBe('2.35');
    expect(roundMoney(D('2.345'), 'HALF_EVEN').toFixed(2)).toBe('2.34');
    expect(roundMoney(D('2.341'), 'CEIL').toFixed(2)).toBe('2.35');
    expect(roundMoney(D('2.349'), 'FLOOR').toFixed(2)).toBe('2.34');
  });
});
