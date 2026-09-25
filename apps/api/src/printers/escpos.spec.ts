import { describe, it, expect } from 'vitest';
import { renderPrintJob } from './escpos.js';

const text = (buf: Buffer) => buf.toString('latin1');

describe('renderPrintJob', () => {
  it('prints a kitchen ticket with table, items, modifiers and notes, then cuts', () => {
    const out = renderPrintJob({
      kind: 'KITCHEN_TICKET',
      ticketType: 'NEW_ORDER',
      table: 'T7',
      orderNumber: '260925-0012',
      stationName: 'Kitchen',
      waiter: 'Hana',
      items: [{ name: 'Cheeseburger', quantity: 2, modifiers: ['No onions'], notes: 'well done' }],
    });
    const s = text(out);
    expect(s).toContain('T7');
    expect(s).toContain('2 x Cheeseburger');
    expect(s).toContain('+ No onions');
    expect(s).toContain('! well done');
    expect(out.subarray(0, 2)).toEqual(Buffer.from([0x1b, 0x40])); // ESC @ initialise
    expect(s.endsWith(String.fromCharCode(0x1d, 0x56, 0x42, 0x00))).toBe(true); // partial cut
  });

  it('marks cancellations loudly', () => {
    expect(text(renderPrintJob({ kind: 'KITCHEN_TICKET', ticketType: 'CANCELLATION', table: 'T2', items: [] }))).toContain('** VOID **');
  });

  it('prints receipts with totals, the COPY marker and the non-fiscal notice', () => {
    const s = text(
      renderPrintJob({
        kind: 'RECEIPT',
        copy: true,
        copyNumber: 1,
        cafeName: 'New Chapter',
        notice: 'Order bill — not a fiscal receipt',
        items: [{ name: 'Latte', quantity: 1, lineTotal: '65.00', modifiers: [] }],
        subtotal: '65.00',
        discount: '0.00',
        serviceCharge: '6.50',
        tax: '10.73',
        total: '82.23',
        payment: { method: 'CASH', applied: '82.23', tendered: '100.00', change: '17.77' },
      }),
    );
    expect(s).toContain('*** COPY 1 ***');
    expect(s).toContain('82.23');
    expect(s).toContain('17.77');
    expect(s).toContain('not a fiscal receipt');
  });

  it('keeps every line within the paper width', () => {
    const s = text(renderPrintJob({ kind: 'RECEIPT', items: [{ name: 'A very long product name that will certainly need wrapping on paper', quantity: 1, lineTotal: '1.00', modifiers: [] }], total: '1.00' }, 32));
    const printable = s.replace(/[\x00-\x09\x0b-\x1f][\x00-\xff]{0,3}/g, '');
    for (const l of printable.split('\n')) expect(l.length).toBeLessThanOrEqual(32);
  });
});
