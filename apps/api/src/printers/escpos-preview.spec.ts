import { describe, it, expect } from 'vitest';
import { renderPrintJob } from './escpos.js';
import { decodeEscPos } from './escpos-preview.js';

const receipt = {
  kind: 'RECEIPT',
  receiptNumber: 'R260925-0001',
  cafeName: 'New Chapter Cafe',
  orderNumber: '260925-0001',
  table: 'T4',
  waiterName: 'Hana',
  currency: 'ETB',
  items: [{ name: 'Macchiato', quantity: 2, lineTotal: '110.00', modifiers: ['Extra shot'] }],
  subtotal: '110.00',
  discount: '0.00',
  serviceCharge: '0.00',
  tax: '16.50',
  total: '126.50',
  payment: { method: 'Cash', applied: '126.50', tendered: '200.00', change: '73.50' },
  footer: 'Thank you',
  notice: 'Order bill — not a fiscal receipt',
};

describe('print preview (decoded from the real printer bytes)', () => {
  const preview = decodeEscPos(renderPrintJob(receipt, 48), 48);
  const texts = preview.blocks.filter((b) => b.kind === 'text') as { text: string; align: string; bold: boolean; doubleHeight: boolean }[];

  it('has every line the printer prints, at the paper width', () => {
    expect(texts.some((t) => t.text.includes('New Chapter Cafe') && t.align === 'center' && t.bold && t.doubleHeight)).toBe(true);
    const item = texts.find((t) => t.text.startsWith('2 x Macchiato'));
    expect(item?.text.length).toBe(48);
    expect(item?.text.endsWith('110.00')).toBe(true);
    expect(texts.some((t) => t.text.includes('TOTAL ETB'))).toBe(true);
  });

  it('ends with the paper cut', () => {
    expect(preview.blocks[preview.blocks.length - 1]).toEqual({ kind: 'cut' });
  });

  it('shows what the printer really prints for characters it cannot (the dash becomes "?")', () => {
    expect(texts.some((t) => t.text.includes('Order bill ? not a fiscal receipt'))).toBe(true);
  });

  it('glues the logo slices back into one image', () => {
    const logo = { widthBytes: 2, height: 200, data: Buffer.alloc(2 * 200, 0xff).toString('base64') };
    const p = decodeEscPos(renderPrintJob({ ...receipt, logo }, 48), 48);
    const images = p.blocks.filter((b) => b.kind === 'image');
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ widthBytes: 2, height: 200, align: 'center' });
  });

  it('kitchen tickets beep', () => {
    const k = decodeEscPos(renderPrintJob({ kind: 'KITCHEN_TICKET', table: 'T4', items: [{ name: 'Burger', quantity: 1 }] }, 48), 48);
    expect(k.blocks.some((b) => b.kind === 'beep')).toBe(true);
  });
});
