import type { Request } from 'express';

/** Minimal Cookie header parser (avoids pulling in cookie-parser for one cookie). */
export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export function cookieIsSecure() {
  if (process.env.COOKIE_SECURE) return process.env.COOKIE_SECURE === 'true';
  return process.env.NODE_ENV === 'production';
}
