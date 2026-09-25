'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

export type Align = 'left' | 'center' | 'right';
export type PreviewBlock =
  | { kind: 'text'; text: string; align: Align; bold: boolean; doubleWidth: boolean; doubleHeight: boolean }
  | { kind: 'image'; align: Align; widthBytes: number; height: number; data: string }
  | { kind: 'feed'; lines: number }
  | { kind: 'cut' }
  | { kind: 'beep' };
export interface PrintPreview {
  columns: number;
  blocks: PreviewBlock[];
}

export interface ReceiptCanvasHandle {
  /** PNG of the paper, for "Download image". */
  toBlob: () => Promise<Blob | null>;
  toDataURL: () => string | null;
}

// Thermal printer geometry (203 dpi, font A): each character is 12 × 24 dots.
const CELL_W = 12;
const CELL_H = 24;
const GAP = 6; // default line spacing ≈ 30 dots
const MARGIN = 18;
const SCALE = 2; // draw at 2× so the image stays sharp when zoomed or downloaded
const FONT = '"IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace';

function blockHeight(b: PreviewBlock) {
  switch (b.kind) {
    case 'text':
      return CELL_H * (b.doubleHeight ? 2 : 1) + GAP;
    case 'image':
      return b.height + GAP;
    case 'feed':
      return b.lines * (CELL_H + GAP);
    case 'cut':
      return 28;
    default:
      return 0;
  }
}

function xFor(align: Align, contentWidth: number, paperWidth: number) {
  if (align === 'center') return Math.max(0, Math.round((paperWidth - contentWidth) / 2));
  if (align === 'right') return Math.max(0, paperWidth - contentWidth);
  return 0;
}

/**
 * Draws a print job the way a thermal printer puts it on paper: same characters per line,
 * same double-size text, the logo dot for dot, and the cut at the end.
 */
export const ReceiptCanvas = forwardRef<ReceiptCanvasHandle, { preview: PrintPreview; className?: string }>(function ReceiptCanvas({ preview, className = '' }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useImperativeHandle(ref, () => ({
    toBlob: () => new Promise((resolve) => (canvas.current ? canvas.current.toBlob(resolve, 'image/png') : resolve(null))),
    toDataURL: () => canvas.current?.toDataURL('image/png') ?? null,
  }));

  useEffect(() => {
    let cancelled = false;
    const draw = () => {
      const el = canvas.current;
      if (!el || cancelled) return;
      const paper = preview.columns * CELL_W;
      // Nothing after the final cut is printed on this ticket.
      const lastCut = preview.blocks.map((b) => b.kind).lastIndexOf('cut');
      const blocks = lastCut >= 0 ? preview.blocks.slice(0, lastCut + 1) : preview.blocks;
      const height = blocks.reduce((h, b) => h + blockHeight(b), 0);

      el.width = (paper + MARGIN * 2) * SCALE;
      el.height = (height + MARGIN * 2) * SCALE;
      const ctx = el.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, paper + MARGIN * 2, height + MARGIN * 2);
      ctx.fillStyle = '#111111';
      ctx.textBaseline = 'top';

      let y = MARGIN;
      for (const b of blocks) {
        if (b.kind === 'text') {
          const sx = b.doubleWidth ? 2 : 1;
          const sy = b.doubleHeight ? 2 : 1;
          const cw = CELL_W * sx;
          // Trailing spaces still take room on the paper, but only matter for right/centre alignment.
          const text = b.text.replace(/\s+$/, '');
          const x0 = MARGIN + xFor(b.align, b.text.replace(/\s+$/, '').length * cw, paper);
          ctx.font = `${b.bold ? 700 : 500} 20px ${FONT}`;
          for (let k = 0; k < text.length; k++) {
            const ch = text[k];
            if (ch === ' ') continue;
            ctx.save();
            ctx.translate(x0 + k * cw, y + 2 * sy);
            ctx.scale(sx, sy);
            ctx.fillText(ch, 0, 0, CELL_W);
            if (b.bold) ctx.fillText(ch, 0.5, 0, CELL_W); // thermal "emphasized" = a slightly heavier stroke
            ctx.restore();
          }
        } else if (b.kind === 'image') {
          const w = b.widthBytes * 8;
          const bits = Uint8Array.from(atob(b.data), (c) => c.charCodeAt(0));
          const x0 = MARGIN + xFor(b.align, w, paper);
          for (let row = 0; row < b.height; row++) {
            for (let col = 0; col < w; col++) {
              const byte = bits[row * b.widthBytes + (col >> 3)];
              if (byte & (0x80 >> (col & 7))) ctx.fillRect(x0 + col, y + row, 1, 1);
            }
          }
        } else if (b.kind === 'cut') {
          ctx.save();
          ctx.strokeStyle = '#9aa09a';
          ctx.setLineDash([6, 5]);
          ctx.beginPath();
          ctx.moveTo(0, y + 14);
          ctx.lineTo(paper + MARGIN * 2, y + 14);
          ctx.stroke();
          ctx.fillStyle = '#9aa09a';
          ctx.font = `16px ${FONT}`;
          ctx.fillText('✂', 4, y + 5);
          ctx.restore();
        }
        y += blockHeight(b);
      }
    };
    // Wait for the web font, so the characters use the same monospace face as the rest of the app.
    if (typeof document !== 'undefined' && document.fonts?.ready) document.fonts.ready.then(draw);
    else draw();
    return () => {
      cancelled = true;
    };
  }, [preview]);

  return <canvas ref={canvas} role="img" aria-label="Printed ticket preview" className={`block h-auto w-full ${className}`} />;
});

/** Opens the image in a small window and prints it at thermal-paper width on this computer's printer. */
export function printImage(dataUrl: string, title: string, columns = 48) {
  const w = window.open('', '_blank', 'width=420,height=700');
  if (!w) return false;
  const mm = columns >= 48 ? 72 : 48; // printable width of 80 mm / 58 mm paper
  w.document.write(`<!doctype html><title>${title.replace(/</g, '&lt;')}</title>
<style>@page{size:${mm + 8}mm auto;margin:4mm}body{margin:0;display:flex;justify-content:center}img{width:${mm}mm;height:auto}</style>
<img src="${dataUrl}" alt="${title.replace(/"/g, '&quot;').replace(/</g, '&lt;')}" onload="setTimeout(function(){window.print()},50)">`);
  w.document.close();
  return true;
}
