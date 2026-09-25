/** Money is kept as strings from the API and only formatted for display. */
export function money(value: string | number | null | undefined, opts: { currency?: string; sign?: boolean } = {}) {
  const n = typeof value === 'number' ? value : Number(value ?? 0);
  const formatted = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n));
  const sign = n < 0 ? '−' : opts.sign && n > 0 ? '+' : '';
  return `${sign}${formatted}${opts.currency ? ` ${opts.currency}` : ''}`;
}

/** Whole-birr display for tiles where cents are noise. */
export function moneyShort(value: string | number) {
  const n = typeof value === 'number' ? value : Number(value);
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n);
}

/**
 * Exact decimal arithmetic on 2dp money strings using integer cents, so the cashier's
 * "change due" never shows 152.44999.
 */
export function toCents(v: string | number): number {
  const s = typeof v === 'number' ? v.toFixed(2) : v.trim();
  if (!/^-?\d+(\.\d{0,2})?$/.test(s)) return NaN;
  const [whole, frac = ''] = s.replace('-', '').split('.');
  const cents = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  return s.startsWith('-') ? -cents : cents;
}
export function fromCents(c: number): string {
  const sign = c < 0 ? '-' : '';
  const a = Math.abs(Math.round(c));
  return `${sign}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}

export function minutesSince(iso: string, now = Date.now()) {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
}

export function elapsed(iso: string, now = Date.now()) {
  const m = minutesSince(iso, now);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function clock(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function dateLabel(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function todayIso() {
  // Business day in Addis (UTC+3).
  return new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
}

export const METHOD_LABEL: Record<string, string> = {
  CASH: 'Cash',
  CARD: 'Card',
  TELEBIRR: 'Telebirr',
  CBE_BIRR: 'CBE Birr',
  BANK_TRANSFER: 'Bank transfer',
};
