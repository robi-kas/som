import { describe, it, expect } from 'vitest';
import * as zlib from 'zlib';
import { decodePng, toRaster } from './logo-raster.js';
import { renderPrintJob } from './escpos.js';

/** Builds a tiny RGBA PNG in memory (CRC not checked by the decoder, so zeros are fine). */
function png(width: number, height: number, pixel: (x: number, y: number) => [number, number, number, number]) {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const rows: number[] = [];
  for (let y = 0; y < height; y++) {
    rows.push(0); // filter: none
    for (let x = 0; x < width; x++) rows.push(...pixel(x, y));
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.from(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('logo raster', () => {
  it('decodes a PNG and turns dark pixels into printer dots', () => {
    // 16×2: left half black, right half white; second row fully transparent (= paper).
    const img = decodePng(png(16, 2, (x, y) => (y === 1 ? [0, 0, 0, 0] : x < 8 ? [0, 0, 0, 255] : [255, 255, 255, 255])))!;
    expect(img.width).toBe(16);
    const r = toRaster(img, 16, 2);
    expect(r.widthBytes).toBe(2);
    expect([...r.data]).toEqual([0xff, 0x00, 0x00, 0x00]);
  });

  it('refuses things that are not PNGs', () => {
    expect(decodePng(Buffer.from('not an image'))).toBeNull();
  });

  it('prints the logo at the top of receipts (GS v 0)', () => {
    const out = renderPrintJob({ kind: 'RECEIPT', cafeName: 'New Chapter', logo: { widthBytes: 2, height: 2, data: Buffer.from([0xff, 0, 0, 0xff]).toString('base64') }, items: [], total: '0.00' });
    expect(out.includes(Buffer.from([0x1d, 0x76, 0x30, 0x00, 2, 0, 2, 0]))).toBe(true);
  });
});
