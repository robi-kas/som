/**
 * Reads the ESC/POS bytes we send to a printer back into a simple list of "what comes out
 * of the printer": text lines with their style, raster images, paper feeds, the cut.
 *
 * The preview is decoded from the real bytes (not re-drawn from the payload), so what the
 * manager sees on screen is what the thermal printer printed: same wrapping, same '?' for
 * characters the printer can't show, same logo.
 *
 * Only the commands our own renderer (escpos.ts) emits are understood; anything else is skipped.
 */

export type Align = 'left' | 'center' | 'right';

export type PreviewBlock =
  | { kind: 'text'; text: string; align: Align; bold: boolean; doubleWidth: boolean; doubleHeight: boolean }
  | { kind: 'image'; align: Align; widthBytes: number; height: number; data: string /* base64, 1 bit per dot, MSB first */ }
  | { kind: 'feed'; lines: number }
  | { kind: 'cut' }
  | { kind: 'beep' };

export interface PrintPreview {
  /** Characters per line: 48 on 80 mm paper, 32 on 58 mm. Dots across = columns × 12. */
  columns: number;
  blocks: PreviewBlock[];
}

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

export function decodeEscPos(buf: Buffer, columns: number): PrintPreview {
  const blocks: PreviewBlock[] = [];
  let align: Align = 'left';
  let bold = false;
  let doubleWidth = false;
  let doubleHeight = false;
  let line: number[] = [];

  const reset = () => {
    align = 'left';
    bold = false;
    doubleWidth = false;
    doubleHeight = false;
  };

  let i = 0;
  while (i < buf.length) {
    const b = buf[i];
    if (b === ESC && i + 1 < buf.length) {
      const cmd = buf[i + 1];
      if (cmd === 0x40) {
        reset();
        i += 2;
      } else if (cmd === 0x61) {
        const n = buf[i + 2];
        align = n === 1 || n === 0x31 ? 'center' : n === 2 || n === 0x32 ? 'right' : 'left';
        i += 3;
      } else if (cmd === 0x45) {
        bold = (buf[i + 2] & 1) === 1;
        i += 3;
      } else if (cmd === 0x64) {
        blocks.push({ kind: 'feed', lines: buf[i + 2] ?? 1 });
        i += 3;
      } else if (cmd === 0x42) {
        blocks.push({ kind: 'beep' });
        i += 4;
      } else {
        i += 3; // ESC t n and other 1-argument commands
      }
    } else if (b === GS && i + 1 < buf.length) {
      const cmd = buf[i + 1];
      if (cmd === 0x21) {
        const n = buf[i + 2] ?? 0;
        doubleWidth = (n & 0x70) !== 0;
        doubleHeight = (n & 0x07) !== 0;
        i += 3;
      } else if (cmd === 0x56) {
        blocks.push({ kind: 'cut' });
        const m = buf[i + 2];
        i += m === 0x41 || m === 0x42 || m === 65 || m === 66 ? 4 : 3;
      } else if (cmd === 0x76 && buf[i + 2] === 0x30) {
        const widthBytes = buf[i + 4] + (buf[i + 5] << 8);
        const rows = buf[i + 6] + (buf[i + 7] << 8);
        const start = i + 8;
        const data = buf.subarray(start, start + widthBytes * rows);
        const prev = blocks[blocks.length - 1];
        // Our renderer sends a tall logo in 128-row slices; glue them back together.
        if (prev && prev.kind === 'image' && prev.widthBytes === widthBytes) {
          const joined = Buffer.concat([Buffer.from(prev.data, 'base64'), data]);
          prev.data = joined.toString('base64');
          prev.height += rows;
        } else {
          blocks.push({ kind: 'image', align, widthBytes, height: rows, data: Buffer.from(data).toString('base64') });
        }
        i = start + widthBytes * rows;
      } else {
        i += 3;
      }
    } else if (b === LF) {
      blocks.push({ kind: 'text', text: Buffer.from(line).toString('latin1'), align, bold, doubleWidth, doubleHeight });
      line = [];
      i += 1;
    } else {
      line.push(b);
      i += 1;
    }
  }
  if (line.length) blocks.push({ kind: 'text', text: Buffer.from(line).toString('latin1'), align, bold, doubleWidth, doubleHeight });
  return { columns, blocks };
}
