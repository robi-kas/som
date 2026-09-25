/**
 * ESC/POS rendering for 80mm (48 columns) and 58mm (32 columns) thermal printers.
 *
 * The API turns a print job's JSON payload into raw printer bytes here; the print agent (or
 * the direct transport) only forwards those bytes to TCP port 9100. Keeping all layout in one
 * place means a receipt looks the same whichever way it reaches the printer.
 *
 * Limitation: printer text mode only has Latin code pages. Ge'ez (Amharic) product names
 * print as '?' — keep a Latin name on printed tickets, or add raster (image) printing later.
 */

const ESC = 0x1b;
const GS = 0x1d;

type Align = 'left' | 'center' | 'right';

class TicketBuilder {
  private chunks: Buffer[] = [];
  constructor(readonly width: number) {
    this.raw(ESC, 0x40); // initialize
    this.raw(ESC, 0x74, 16); // code page WPC1252
  }
  raw(...bytes: number[]) {
    this.chunks.push(Buffer.from(bytes));
    return this;
  }
  align(a: Align) {
    return this.raw(ESC, 0x61, a === 'left' ? 0 : a === 'center' ? 1 : 2);
  }
  bold(on: boolean) {
    return this.raw(ESC, 0x45, on ? 1 : 0);
  }
  /** 0 = normal, 1 = double height, 2 = double width+height. */
  size(level: 0 | 1 | 2) {
    return this.raw(GS, 0x21, level === 0 ? 0x00 : level === 1 ? 0x01 : 0x11);
  }
  text(line: string) {
    this.chunks.push(Buffer.from(toPrintable(line) + '\n', 'latin1'));
    return this;
  }
  /** Text wrapped to the current width (divided by `scale` for double-width text). */
  wrapped(line: string, scale = 1, indent = '') {
    for (const l of wrap(line, Math.floor(this.width / scale), indent)) this.text(l);
    return this;
  }
  twoCol(left: string, right: string) {
    const room = this.width - right.length - 1;
    const lines = wrap(left, Math.max(room, 8));
    lines.forEach((l, i) => this.text(i === lines.length - 1 ? l.padEnd(this.width - right.length) + right : l));
    return this;
  }
  rule(char = '-') {
    return this.text(char.repeat(this.width));
  }
  feed(n = 1) {
    return this.raw(ESC, 0x64, n);
  }
  cut() {
    this.feed(3);
    return this.raw(GS, 0x56, 0x42, 0x00); // partial cut
  }
  /** Prints a 1-bit bitmap (GS v 0), in 128-row slices for printers with small buffers. */
  image(widthBytes: number, height: number, data: Buffer) {
    for (let y = 0; y < height; y += 128) {
      const rows = Math.min(128, height - y);
      this.raw(GS, 0x76, 0x30, 0x00, widthBytes & 0xff, widthBytes >> 8, rows & 0xff, rows >> 8);
      this.chunks.push(data.subarray(y * widthBytes, (y + rows) * widthBytes));
    }
    return this;
  }
  beep() {
    return this.raw(ESC, 0x42, 3, 2); // supported by most kitchen printers; ignored otherwise
  }
  build() {
    return Buffer.concat(this.chunks);
  }
}

function toPrintable(s: string) {
  // Replace characters the printer's Latin code page can't show.
  return s.normalize('NFKD').replace(/[^\x20-\x7e\xa0-\xff]/g, '?');
}

function wrap(text: string, width: number, indent = ''): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= width) current = candidate;
    else {
      if (current) lines.push(current);
      current = (indent + word).slice(0, width);
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

function time(iso?: unknown) {
  const d = typeof iso === 'string' ? new Date(iso) : new Date();
  return d.toLocaleString('en-GB', {
    timeZone: process.env.BUSINESS_TIMEZONE ?? 'Africa/Addis_Ababa',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

type Json = Record<string, unknown>;
const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : fallback);

function kitchenTicket(p: Json, width: number) {
  const t = new TicketBuilder(width);
  const type = str(p.ticketType, 'NEW_ORDER');
  t.beep().align('center');
  if (type === 'CANCELLATION') t.bold(true).size(2).text('** VOID **').size(0).bold(false);
  else if (type === 'ADDITION') t.bold(true).size(1).text('+ ADDITION +').size(0).bold(false);
  t.bold(true).size(2).text(str(p.table, 'Takeaway')).size(0).bold(false);
  t.text(`${str(p.stationName, 'Kitchen')}  #${str(p.orderNumber)}`);
  t.text(`${time(p.firedAt)}  ${str(p.waiter)}`);
  t.align('left').rule('=');
  for (const item of (p.items as Json[] | undefined) ?? []) {
    t.bold(true).size(1).wrapped(`${str(item.quantity)} x ${str(item.name)}`, 1, '    ').size(0).bold(false);
    for (const m of (item.modifiers as string[] | undefined) ?? []) t.wrapped(`   + ${m}`);
    if (item.notes) t.bold(true).wrapped(`   ! ${str(item.notes)}`).bold(false);
  }
  t.rule('=');
  return t.cut().build();
}

function receipt(p: Json, width: number) {
  const t = new TicketBuilder(width);
  const cur = str(p.currency, 'ETB');
  t.align('center');
  const logo = p.logo as { widthBytes: number; height: number; data: string } | undefined;
  if (logo && logo.widthBytes > 0 && logo.height > 0 && typeof logo.data === 'string') {
    t.image(logo.widthBytes, logo.height, Buffer.from(logo.data, 'base64')).feed(1);
  }
  t.bold(true).size(1).wrapped(str(p.cafeName)).size(0).bold(false);
  if (p.branchName) t.text(str(p.branchName));
  if (p.tin) t.text(`TIN: ${str(p.tin)}`);
  if (p.copy) t.bold(true).text(`*** COPY ${str(p.copyNumber)} ***`).bold(false);
  t.text(p.kind === 'BILL' ? 'BILL' : `Receipt ${str(p.receiptNumber)}`);
  t.align('left').rule();
  t.twoCol(`Order #${str(p.orderNumber)}`, str(p.table));
  t.twoCol(time(p.timestamp), str(p.waiterName));
  t.rule();
  for (const item of (p.items as Json[] | undefined) ?? []) {
    t.twoCol(`${str(item.quantity)} x ${str(item.name)}`, str(item.lineTotal));
    for (const m of (item.modifiers as string[] | undefined) ?? []) t.wrapped(`   + ${m}`);
  }
  t.rule();
  t.twoCol('Subtotal', str(p.subtotal));
  if (p.discount && p.discount !== '0.00') t.twoCol('Discount', `-${str(p.discount)}`);
  if (p.serviceCharge && p.serviceCharge !== '0.00') t.twoCol('Service charge', str(p.serviceCharge));
  t.twoCol('VAT', str(p.tax));
  t.bold(true).size(1).twoCol(`TOTAL ${cur}`, str(p.total)).size(0).bold(false);
  const pay = p.payment as Json | null | undefined;
  if (pay) {
    t.rule();
    t.twoCol(`Paid (${str(pay.method)})`, str(pay.applied));
    if (pay.method === 'CASH' || pay.method === 'Cash') {
      t.twoCol('Tendered', str(pay.tendered));
      t.twoCol('Change', str(pay.change));
    }
    if (pay.reference) t.twoCol('Ref', str(pay.reference));
    if (p.balanceDue && p.balanceDue !== '0.00') t.bold(true).twoCol('Balance due', str(p.balanceDue)).bold(false);
  }
  const payTo = (p.payTo as { name: string; account: string }[] | undefined) ?? [];
  if (p.kind === 'BILL' && payTo.length) {
    t.rule();
    t.bold(true).text('Pay by').bold(false);
    for (const m of payTo) t.twoCol(m.name, m.account);
  }
  t.rule().align('center');
  if (p.footer) t.wrapped(str(p.footer));
  t.wrapped(str(p.notice));
  return t.cut().build();
}

function testPage(p: Json, width: number) {
  const t = new TicketBuilder(width);
  t.align('center').bold(true).size(2).text('TEST').size(0).bold(false);
  t.text(str(p.printerName));
  t.text(time());
  t.rule();
  t.text('If you can read this, the');
  t.text('printer is set up correctly.');
  return t.cut().build();
}

export function renderPrintJob(payload: unknown, width = Number(process.env.PRINTER_COLUMNS ?? 48)): Buffer {
  const p = (payload ?? {}) as Json;
  switch (p.kind) {
    case 'RECEIPT':
    case 'BILL':
      return receipt(p, width);
    case 'TEST':
      return testPage(p, width);
    case 'KITCHEN_TICKET':
    default:
      return kitchenTicket(p, width);
  }
}
