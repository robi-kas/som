import * as fs from 'fs';
import * as zlib from 'zlib';

/**
 * Turns the cafe's PNG logo into a 1-bit bitmap a thermal printer can print (ESC/POS raster).
 *
 * Uses only Node's built-in zlib: a PNG is a few chunks of deflated scanlines, which is simple
 * enough to decode here instead of adding an image library. Supports the PNGs people actually
 * export (8-bit greyscale / RGB / RGBA / palette, not interlaced). Anything else simply prints
 * without the logo.
 */

export interface Raster {
  widthBytes: number; // bytes per row (8 dots each)
  height: number;
  data: Buffer; // 1 = black dot
}

interface Rgba {
  width: number;
  height: number;
  pixels: Uint8Array; // RGBA, 4 bytes per pixel
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function decodePng(buf: Buffer): Rgba | null {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette: Buffer | null = null;
  let transparency: Buffer | null = null;
  const idat: Buffer[] = [];

  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') transparency = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }

  if (!width || !height || bitDepth !== 8 || interlace !== 0) return null;
  if (width * height > 4_000_000) return null; // refuse absurdly large images
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType as 0 | 2 | 3 | 4 | 6];
  if (!channels) return null;

  let raw: Buffer;
  try {
    raw = zlib.inflateSync(Buffer.concat(idat));
  } catch {
    return null;
  }

  const stride = width * channels;
  const out = Buffer.alloc(stride * height);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
    prev = cur;
  }

  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * channels;
    let r: number, g: number, b: number, alpha = 255;
    if (colorType === 0) r = g = b = out[s];
    else if (colorType === 4) {
      r = g = b = out[s];
      alpha = out[s + 1];
    } else if (colorType === 2) {
      r = out[s];
      g = out[s + 1];
      b = out[s + 2];
    } else if (colorType === 6) {
      r = out[s];
      g = out[s + 1];
      b = out[s + 2];
      alpha = out[s + 3];
    } else {
      const idx = out[s];
      if (!palette || idx * 3 + 2 >= palette.length) return null;
      r = palette[idx * 3];
      g = palette[idx * 3 + 1];
      b = palette[idx * 3 + 2];
      if (transparency && idx < transparency.length) alpha = transparency[idx];
    }
    pixels.set([r, g, b, alpha], i * 4);
  }
  return { width, height, pixels };
}

/** Scales to fit, flattens onto white paper, and thresholds to black/white dots. */
export function toRaster(img: Rgba, maxWidthDots = 320, maxHeightDots = 160): Raster {
  const scale = Math.min(1, maxWidthDots / img.width, maxHeightDots / img.height);
  const w = Math.max(8, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const widthBytes = Math.ceil(w / 8);
  const data = Buffer.alloc(widthBytes * h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(img.height - 1, Math.floor(y / scale));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, Math.floor(x / scale));
      const i = (sy * img.width + sx) * 4;
      const a = img.pixels[i + 3] / 255;
      // Composite over white paper, then perceived luminance.
      const lum = (0.299 * img.pixels[i] + 0.587 * img.pixels[i + 1] + 0.114 * img.pixels[i + 2]) * a + 255 * (1 - a);
      if (lum < 140) data[y * widthBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { widthBytes, height: h, data };
}

const cache = new Map<string, { mtime: number; raster: Raster | null }>();

/** The printable logo for a file on disk (cached until the file changes). Null if it can't be printed. */
export function logoRasterFor(filePath: string, paperColumns = Number(process.env.PRINTER_COLUMNS ?? 48)): Raster | null {
  try {
    const stat = fs.statSync(filePath);
    const hit = cache.get(filePath);
    if (hit && hit.mtime === stat.mtimeMs) return hit.raster;
    const img = decodePng(fs.readFileSync(filePath));
    // 80mm paper ≈ 576 dots wide, 58mm ≈ 384: keep the logo to about half the width.
    const raster = img ? toRaster(img, paperColumns >= 42 ? 320 : 240, 160) : null;
    cache.set(filePath, { mtime: stat.mtimeMs, raster });
    return raster;
  } catch {
    return null;
  }
}
