/**
 * The real image type, read from the file's first bytes. Browsers send whatever type the
 * file name suggests, so a renamed file could claim to be a PNG; this can't be fooled that way.
 */
export function sniffImage(buf: Buffer): 'png' | 'jpeg' | 'webp' | null {
  if (buf.length > 8 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/** The mime type matching the file's real contents, or null if it isn't a PNG/JPEG/WebP. */
export const realImageMime = (buf: Buffer) => {
  const t = sniffImage(buf);
  return t ? `image/${t}` : null;
};
