'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, errorText, newIdempotencyKey } from '@/lib/api';
import { useT, type I18nKey } from '@/lib/i18n';
import { fromCents, money, toCents } from '@/lib/format';
import type { OrderDetail, PaymentMethodConfig, PaymentSummary } from '@/lib/types';
import { useSession } from '@/lib/session';
import { compressPhoto } from '@/lib/image';
import { ReferenceEditor } from '@/components/cashier/ReferenceEditor';
import { MethodLogo } from '@/components/payments/MethodLogo';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Pill } from '@/components/ui/Pill';
import { Sheet } from '@/components/ui/Sheet';
import { Input } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { useToast } from '@/components/ui/Toast';


/** Amounts a customer is likely to hand over: exact, then the next round notes. */
function quickCash(dueCents: number) {
  const steps = [5000, 10000, 20000, 50000, 100000]; // 50, 100, 200, 500, 1000 birr
  const out = new Set<number>([dueCents]);
  for (const s of steps) {
    const up = Math.ceil(dueCents / s) * s;
    if (up > dueCents) out.add(up);
    if (out.size >= 4) break;
  }
  return [...out].sort((a, b) => a - b).slice(0, 4);
}

export function PaymentPanel({
  order,
  methods,
  onChanged,
  onDone,
}: {
  order: OrderDetail;
  methods: PaymentMethodConfig[];
  onChanged: () => void;
  onDone: () => void;
}) {
  const { t } = useT();
  const toast = useToast();
  const dueCents = toCents(order.balanceDue);
  const pendingCents = order.payments.filter((p) => p.status === 'PENDING_VERIFICATION').reduce((a, p) => a + toCents(p.appliedAmount), 0);
  const payableCents = Math.max(0, dueCents - pendingCents);

  const [method, setMethod] = useState<string>('CASH');
  const [payerBank, setPayerBank] = useState('');
  const cfg = methods.find((m) => m.code === method) ?? methods[0];
  const isCash = cfg?.kind === 'CASH';
  const counterMethods = methods.filter((m) => m.kind === 'CASH' || m.kind === 'CARD');
  const walletMethods = methods.filter((m) => m.kind !== 'CASH' && m.kind !== 'CARD');
  const nameOf = (code: string) => methods.find((m) => m.code === code)?.name ?? code;
  const [partCents, setPartCents] = useState<number>(payableCents); // how much of the bill this payment covers
  const [tendered, setTendered] = useState('');
  const [sentOver, setSentOver] = useState(''); // transfer bigger than the bill: what the customer actually sent
  const [reference, setReference] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [done, setDone] = useState<{ change: string; methodName: string; pending: boolean } | null>(null);
  const idem = useRef(newIdempotencyKey());

  // New bill selected: start clean.
  useEffect(() => {
    setTendered('');
    setSentOver('');
    setReference('');
    setPayerBank('');
    setPhoto(null);
    setDone(null);
    idem.current = newIdempotencyKey();
  }, [order.id]);
  // Balance changed (payment, discount, items added): default to paying what's left.
  useEffect(() => {
    setPartCents(payableCents);
  }, [payableCents]);

  // Telebirr / bank: if the customer sent more than the bill, the difference goes back in cash
  // from the drawer. A card is charged the exact amount, so it never has change.
  const isWallet = !!cfg && !isCash && cfg.kind !== 'CARD';
  // Same rule as the waiter's phone: type what the customer sent. Less = part payment, more = change.
  const walletSentCents = sentOver ? toCents(sentOver) : partCents;
  const walletAppliedCents = Number.isNaN(walletSentCents) ? 0 : Math.min(walletSentCents, partCents);
  const appliedCents = isWallet ? walletAppliedCents : partCents;
  const tenderedCents = isCash ? (tendered ? toCents(tendered) : NaN) : isWallet ? walletSentCents : partCents;
  const changeCents = (isCash || isWallet) && !Number.isNaN(tenderedCents) ? Math.max(0, tenderedCents - partCents) : 0;
  const quick = useMemo(() => quickCash(partCents), [partCents]);

  const canPay =
    partCents > 0 &&
    partCents <= payableCents &&
    !!cfg &&
    (!isCash || (!Number.isNaN(tenderedCents) && tenderedCents >= partCents)) &&
    (!isWallet || (!Number.isNaN(walletSentCents) && walletAppliedCents > 0 && changeCents <= walletAppliedCents)) &&
    // The transaction number can be skipped and added later, but if typed it must look right.
    (!reference.trim() || reference.trim().length >= 4) &&
    (!cfg.askPayerBank || payerBank.trim().length >= 2) &&
    (!cfg.requiresProof || !!photo);

  const pay = async () => {
    if (!canPay) return;
    setBusy(true);
    try {
      const payment = await api.post<{ id: string; status: string; changeAmount: string }>(
        `/orders/${order.id}/payments`,
        {
          method,
          appliedAmount: fromCents(appliedCents),
          tenderedAmount: fromCents(isCash || isWallet ? tenderedCents : partCents),
          currency: order.currency,
          referenceNumber: !isCash && reference.trim() ? reference.trim() : undefined,
          payerBank: cfg?.askPayerBank ? payerBank.trim() : undefined,
        },
        { headers: { 'Idempotency-Key': idem.current } },
      );
      if (photo && payment.status === 'PENDING_VERIFICATION') {
        const form = new FormData();
        form.append('file', photo);
        await api.upload(`/payments/${payment.id}/evidence`, form).catch(() => toast('Payment saved, but the screenshot failed to upload', 'error'));
      }
      idem.current = newIdempotencyKey();
      setDone({ change: payment.changeAmount, methodName: cfg?.askPayerBank ? `${cfg.name}: ${payerBank}` : (cfg?.name ?? method), pending: payment.status === 'PENDING_VERIFICATION' });
      onChanged();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'PAYMENT_BALANCE_EXCEEDED') onChanged();
      toast(errorText(e), 'error');
      // Keep the same key after a network error: if the server did record the payment before
      // the connection dropped, retrying with this key returns that payment instead of charging twice.
      if (e instanceof ApiError && e.status >= 400) idem.current = newIdempotencyKey();
    } finally {
      setBusy(false);
    }
  };

  const printBill = async () => {
    try {
      await api.post(`/orders/${order.id}/print-bill`);
      toast('Bill sent to printer');
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };

  if (done) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <span className="grid h-16 w-16 place-items-center rounded-full bg-primary text-ink">
          <Icon name="check" size={32} strokeWidth={3} />
        </span>
        {done.pending ? (
          <>
            <p className="font-display text-display-md">{t('cashier.waitingVerify')}</p>
            <p className="max-w-xs text-sm text-mute">
              {reference
                ? `${done.methodName} ref. ${reference} is recorded. Check it against the statement; the receipt prints then.`
                : `${done.methodName} is recorded without a transaction number. Add it from “Needs transaction number” before you close the drawer.`}
            </p>
            {toCents(done.change) > 0 && (
              <div className="rounded-xl bg-ink px-8 py-4 text-white">
                <p className="text-sm text-[#b9bdb4]">Give change in cash</p>
                <p className="font-display text-[44px] font-black leading-none tnum">{money(done.change)}</p>
              </div>
            )}
          </>
        ) : (
          <>
            <p className="font-display text-display-md">{t('cashier.paid')}</p>
            {toCents(done.change) > 0 && (
              <div className="rounded-xl bg-ink px-8 py-4 text-white">
                <p className="text-sm text-[#b9bdb4]">{t('cashier.change')}</p>
                <p className="font-display text-[44px] font-black leading-none tnum">{money(done.change)}</p>
              </div>
            )}
            <p className="text-sm text-mute">Receipt is printing.</p>
          </>
        )}
        <div className="mt-2 flex gap-2">
          {payableCents > 0 && (
            <Button variant="outline" size="lg" onClick={() => setDone(null)}>
              Next part
            </Button>
          )}
          <Button size="lg" onClick={onDone}>
            Next bill
          </Button>
        </div>
      </div>
    );
  }

  // Fully paid but still open (paid before auto-close existed, or items never sent).
  if (payableCents === 0 && pendingCents === 0 && order.canEdit) {
    const unsent = order.items.filter((i) => i.status === 'PENDING');
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <span className="grid h-16 w-16 place-items-center rounded-full bg-primary text-ink">
          <Icon name="check" size={32} strokeWidth={3} />
        </span>
        <p className="font-display text-display-md">Paid in full</p>
        {unsent.length > 0 ? (
          <p className="max-w-sm text-sm text-warning-deep">
            {unsent.map((i) => `${i.quantity}× ${i.productNameSnapshot}`).join(', ')} {unsent.length === 1 ? 'is' : 'are'} paid for but {unsent.length === 1 ? 'was' : 'were'} never sent.
            Closing sends {unsent.length === 1 ? 'it' : 'them'} now: fridge items count as handed over, anything cooked gets a ticket.
          </p>
        ) : (
          <p className="max-w-sm text-sm text-mute">Close the bill to free {order.tableName ?? 'the order'} and count the sale.</p>
        )}
        <Button
          size="xl"
          onClick={async () => {
            try {
              if (unsent.length > 0) await api.post(`/orders/${order.id}/fire`, { expectedVersion: order.version });
              await api.post(`/orders/${order.id}/complete`);
              toast('Bill closed');
              onChanged();
              onDone();
            } catch (e) {
              toast(errorText(e), 'error');
            }
          }}
        >
          {unsent.length > 0 ? 'Send & close bill' : 'Close bill'}
        </Button>
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      {/* Bill */}
      <section className="flex min-h-0 flex-col border-b border-line lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between gap-2 px-5 pb-2 pt-4">
          <div>
            <h2 className="font-display text-display-md">{order.tableName ?? t('common.takeaway')}</h2>
            <p className="text-xs text-mute">
              #{order.orderNumber} · {order.waiterName}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={printBill}>
            <Icon name="receipt" size={16} /> {t('cashier.printBill')}
          </Button>
        </div>
        <ul className="flex-1 overflow-y-auto px-5 text-sm">
          {order.items
            .filter((i) => i.status !== 'CANCELLED')
            .map((i) => (
              <li key={i.id} className="flex justify-between gap-3 border-b border-dashed border-line py-2 tnum">
                <span>
                  {i.quantity} × {i.productNameSnapshot}
                  {i.modifiers.length > 0 && <span className="block text-xs text-mute">{i.modifiers.map((m) => `+ ${m.name}`).join(', ')}</span>}
                  {i.status !== 'SERVED' && <span className="ml-1 text-xs text-warning-deep">({t(`order.status.${i.status}` as I18nKey)})</span>}
                </span>
                <span>{money(i.lineTotal)}</span>
              </li>
            ))}
        </ul>
        <dl className="flex flex-col gap-1 px-5 py-3 text-sm tnum">
          <Line label={t('common.subtotal')} value={money(order.subtotal)} />
          {toCents(order.discountAmount) > 0 && <Line label={`${t('common.discount')}${order.discountReason ? ` (${order.discountReason})` : ''}`} value={`−${money(order.discountAmount)}`} />}
          {toCents(order.serviceChargeAmount) > 0 && <Line label={t('common.service')} value={money(order.serviceChargeAmount)} />}
          <Line label={t('common.vat')} value={money(order.taxAmount)} />
          <div className="flex items-baseline justify-between pt-1">
            <dt className="font-semibold">{t('common.total')}</dt>
            <dd className="font-display text-display-md">{money(order.totalAmount)}</dd>
          </div>
          {order.payments
            .filter((p) => p.status !== 'REJECTED')
            .map((p) => (
              <Line key={p.id} label={`${p.methodName ?? nameOf(p.method)}${p.status === 'PENDING_VERIFICATION' ? ' · pending check' : ''}`} value={`−${money(p.appliedAmount)}`} />
            ))}
        </dl>
        <div className="flex gap-2 px-5 pb-4">
          <Button variant="secondary" size="sm" onClick={() => setDiscountOpen(true)} disabled={order.payments.some((p) => p.status !== 'REJECTED')}>
            <Icon name="tag" size={16} /> {t('cashier.discount')}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setSplitOpen(true)}>
            <Icon name="split" size={16} /> {t('cashier.split')}
          </Button>
        </div>
      </section>

      {/* Tender */}
      <section className="flex min-h-0 flex-col gap-4 overflow-y-auto p-5">
        <div className="flex items-baseline justify-between rounded-lg bg-ink px-4 py-3 text-white">
          <span className="text-sm text-[#b9bdb4]">
            {partCents < payableCents ? `${t('cashier.payPart')} (of ${money(fromCents(payableCents))})` : t('cashier.amountDue')}
          </span>
          <span className="font-display text-[36px] font-black leading-none tnum">{money(fromCents(partCents))}</span>
        </div>
        {pendingCents > 0 && (
          <div className="flex flex-col gap-2 rounded-md bg-info-bg px-3 py-2 text-sm text-info">
            <p>
              {money(fromCents(pendingCents))} {t('cashier.waitingVerify').toLowerCase()}. Check your phone or bank app, then mark it.
            </p>
            {order.payments
              .filter((p) => p.status === 'PENDING_VERIFICATION')
              .map((p) => (
                <VerifyRow key={p.id} p={p} label={p.methodName ?? nameOf(p.method)} hasProof={!!methods.find((m) => m.code === p.method)?.requiresProof} onChanged={onChanged} />
              ))}
          </div>
        )}

        {/* Cash and card: one tap, always first. */}
        <div className="grid grid-cols-2 gap-2">
          {counterMethods.map((m) => (
            <MethodButton key={m.code} m={m} on={method === m.code} onPick={() => setMethod(m.code)} big />
          ))}
        </div>
        {walletMethods.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-bold uppercase tracking-wider text-mute">Mobile money & bank apps</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {walletMethods.map((m) => (
                <MethodButton key={m.code} m={m} on={method === m.code} onPick={() => setMethod(m.code)} />
              ))}
            </div>
          </div>
        )}

        {isCash ? (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {quick.map((c) => (
                <button
                  key={c}
                  onClick={() => setTendered(fromCents(c))}
                  className={`h-14 rounded-md font-display text-lg font-extrabold tnum ${toCents(tendered || '-1') === c ? 'bg-primary text-ink' : 'bg-canvas-sunk hover:bg-line'}`}
                >
                  {c === partCents ? 'Exact' : money(fromCents(c)).replace('.00', '')}
                </button>
              ))}
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold">{t('cashier.tendered')}</span>
              <Input id="tendered" inputMode="decimal" className="h-14 font-display text-2xl font-bold" placeholder="0.00" value={tendered} onChange={(e) => setTendered(e.target.value.replace(/[^\d.]/g, ''))} />
            </label>
            <div className={`flex items-baseline justify-between rounded-lg px-4 py-3 ${changeCents < 0 ? 'bg-negative-bg text-negative' : 'bg-primary-pale'}`}>
              <span className="text-sm font-semibold">{changeCents < 0 ? 'Still short' : t('cashier.change')}</span>
              <span className="font-display text-[32px] font-black leading-none tnum">{Number.isNaN(tenderedCents) ? '—' : money(fromCents(Math.abs(changeCents)))}</span>
            </div>
          </>
        ) : cfg ? (
          <>
            {cfg.accountInfo && (
              // Turned towards the customer: where to send the money.
              <div className="flex items-center gap-3 rounded-lg border-2 border-ink bg-canvas px-4 py-3">
                <MethodLogo code={cfg.code} name={cfg.name} size={44} />
                <div className="min-w-0">
                  <p className="text-xs text-mute">Customer sends {money(fromCents(partCents))} ETB to</p>
                  <p className="break-all font-display text-2xl font-black tnum">{cfg.accountInfo}</p>
                </div>
              </div>
            )}
            {cfg.askPayerBank && (
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-semibold">Which bank or app?</span>
                <Input id="payer-bank" placeholder="e.g. Wegagen, Nib, Siinqee, Abay…" value={payerBank} onChange={(e) => setPayerBank(e.target.value)} maxLength={60} />
              </label>
            )}
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold">
                {t('cashier.reference')}{' '}
                <span className="font-normal text-mute">{cfg.requiresReference ? '(can be added later)' : '(optional)'}</span>
              </span>
              <Input id="reference" autoCapitalize="characters" placeholder={t('cashier.referenceHint')} value={reference} onChange={(e) => setReference(e.target.value.toUpperCase())} />
            </label>
            {isWallet && (
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-semibold">
                  How much did they send? <span className="font-normal text-mute">(leave empty if exactly {money(fromCents(partCents))})</span>
                </span>
                <Input id="sent-over" inputMode="decimal" placeholder={`e.g. ${money(fromCents(Math.ceil((partCents || 1) / 10000) * 10000))}`} value={sentOver} onChange={(e) => setSentOver(e.target.value.replace(/[^\d.]/g, ''))} />
                {changeCents > 0 && changeCents <= partCents && (
                  <span className="rounded-md bg-warning-bg px-3 py-2 text-sm font-semibold text-warning-deep">Give {money(fromCents(changeCents))} change in cash from the drawer.</span>
                )}
                {changeCents > partCents && <span className="text-sm text-negative">Change can’t be more than the bill.</span>}
                {sentOver && !Number.isNaN(walletSentCents) && walletSentCents > 0 && walletSentCents < partCents && (
                  <span className="rounded-md bg-info-bg px-3 py-2 text-sm font-semibold text-info">
                    Part payment. {money(fromCents(partCents - walletSentCents))} stays on the bill — take it next (e.g. cash).
                  </span>
                )}
              </label>
            )}
            {(cfg.requiresProof || cfg.requiresVerification) && (
              <label className={`flex cursor-pointer items-center gap-3 rounded-md border-2 border-dashed px-4 py-3 text-sm hover:border-ink ${cfg.requiresProof && !photo ? 'border-warning-deep bg-warning-bg' : 'border-line'}`}>
                <Icon name="camera" />
                <span className="flex-1">
                  {photo ? photo.name : t('cashier.photo')}
                  {cfg.requiresProof && !photo && <span className="block text-xs font-semibold text-warning-deep">Required for {cfg.name}</span>}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="sr-only"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    try {
                      const small = await compressPhoto(f);
                      setPhoto(new File([small], f.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }));
                    } catch {
                      setPhoto(f);
                    }
                  }}
                />
              </label>
            )}
            {cfg.requiresVerification && <p className="text-xs text-mute">Recorded as pending. A manager checks it against the {cfg.name} statement before it counts as paid.</p>}
          </>
        ) : null}

        <Button size="xl" block onClick={pay} loading={busy} disabled={!canPay} className="mt-auto">
          {t('cashier.pay')} · {money(fromCents(appliedCents))}
        </Button>
      </section>

      <SplitSheet open={splitOpen} onClose={() => setSplitOpen(false)} payableCents={payableCents} onPick={(c) => { setPartCents(c); setSplitOpen(false); }} />
      <DiscountSheet open={discountOpen} onClose={() => setDiscountOpen(false)} order={order} onApplied={() => { setDiscountOpen(false); onChanged(); }} />
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 text-body">
      <dt className="truncate">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function SplitSheet({ open, onClose, payableCents, onPick }: { open: boolean; onClose: () => void; payableCents: number; onPick: (cents: number) => void }) {
  const { t } = useT();
  const [custom, setCustom] = useState('');
  const shares = [2, 3, 4, 5];
  return (
    <Sheet open={open} onClose={onClose} title={t('cashier.split')}>
      <div className="flex flex-col gap-4 pb-2">
        <p className="text-sm text-mute">Take one person’s share now; the rest stays open on the bill.</p>
        <div className="grid grid-cols-2 gap-2">
          {shares.map((n) => (
            <button key={n} onClick={() => onPick(Math.ceil(payableCents / n))} className="flex h-16 flex-col items-center justify-center rounded-md bg-canvas-sunk hover:bg-line">
              <span className="text-sm text-mute">{n} ways</span>
              <span className="font-display text-lg font-extrabold tnum">{money(fromCents(Math.ceil(payableCents / n)))}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Input id="split-custom" inputMode="decimal" placeholder="Custom amount" value={custom} onChange={(e) => setCustom(e.target.value.replace(/[^\d.]/g, ''))} />
          <Button size="lg" disabled={!custom || toCents(custom) <= 0 || toCents(custom) > payableCents} onClick={() => onPick(toCents(custom))}>
            Use
          </Button>
        </div>
        <Button variant="ghost" onClick={() => onPick(payableCents)}>
          Whole bill
        </Button>
      </div>
    </Sheet>
  );
}

function DiscountSheet({ open, onClose, order, onApplied }: { open: boolean; onClose: () => void; order: OrderDetail; onApplied: () => void }) {
  const toast = useToast();
  const [type, setType] = useState<'PERCENT' | 'FIXED'>('PERCENT');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const apply = async (remove = false) => {
    setBusy(true);
    try {
      await api.post(`/orders/${order.id}/discount`, remove ? { expectedVersion: order.version, type: 'NONE' } : { expectedVersion: order.version, type, value, reason });
      toast(remove ? 'Discount removed' : 'Discount applied');
      onApplied();
    } catch (e) {
      if (!(e instanceof ApiError && e.code === 'APPROVAL_CANCELLED')) toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Discount">
      <div className="flex flex-col gap-4 pb-2">
        <Segmented<'PERCENT' | 'FIXED'>
          value={type}
          onChange={setType}
          options={[
            { value: 'PERCENT', label: 'Percent %' },
            { value: 'FIXED', label: 'Amount ETB' },
          ]}
        />
        {type === 'PERCENT' && (
          <div className="flex gap-2">
            {['5', '10', '15', '20'].map((p) => (
              <button key={p} onClick={() => setValue(p)} className={`h-11 flex-1 rounded-md font-bold ${value === p ? 'bg-ink text-white' : 'bg-canvas-sunk'}`}>
                {p}%
              </button>
            ))}
          </div>
        )}
        <Input id="discount-value" inputMode="decimal" placeholder={type === 'PERCENT' ? 'Percent' : 'Amount'} value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ''))} />
        <Input id="discount-reason" placeholder="Reason (required) — e.g. regular customer, staff meal" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
        <p className="text-xs text-mute">Above the branch limit (usually 10%) a manager approves with their PIN. Every discount is logged with who gave it and why.</p>
        <Button size="lg" onClick={() => apply()} loading={busy} disabled={!value || reason.trim().length < 3}>
          Apply discount
        </Button>
        {order.discountType && (
          <Button variant="ghost" onClick={() => apply(true)}>
            Remove current discount
          </Button>
        )}
      </div>
    </Sheet>
  );
}

function MethodButton({ m, on, onPick, big }: { m: PaymentMethodConfig; on: boolean; onPick: () => void; big?: boolean }) {
  return (
    <button
      onClick={onPick}
      aria-pressed={on}
      className={`flex items-center gap-2.5 rounded-md border-2 px-2.5 text-left text-sm font-bold transition-colors h-14 ${
        on ? 'border-ink bg-primary-pale shadow-[inset_0_0_0_1px_#0e0f0c]' : 'border-line bg-canvas hover:border-body'
      }`}
    >
      <MethodLogo code={m.code} name={m.name} size={big ? 36 : 32} />
      <span className="min-w-0 leading-tight">{m.name}</span>
    </button>
  );
}

/** "Did the money actually arrive?" — the cashier answers right on the bill. */
function VerifyRow({ p, label, hasProof, onChanged }: { p: PaymentSummary; label: string; hasProof: boolean; onChanged: () => void }) {
  const { can } = useSession();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  async function confirm() {
    setBusy(true);
    try {
      await api.post(`/payments/${p.id}/confirm`, {}, { headers: { 'Idempotency-Key': newIdempotencyKey() } });
      toast(
        p.reportedByWaiter && toCents(p.changeAmount) > 0
          ? `${label} received — give ${money(p.changeAmount)} change from the drawer`
          : `${label} ${money(p.appliedAmount)} received`,
        'ok',
      );
      onChanged();
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  }
  async function reject() {
    if (!reason.trim()) return;
    setBusy(true);
    try {
      await api.post(`/payments/${p.id}/reject`, { reason: reason.trim() });
      toast(
        toCents(p.changeAmount) > 0 && !p.reportedByWaiter
          ? `Marked not received. Note: ${money(p.changeAmount)} cash change was already given — follow up with the customer.`
          : 'Marked not received — the amount is back on the bill',
        'ok',
      );
      setRejecting(false);
      setReason('');
      onChanged();
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md bg-canvas px-3 py-2 text-ink">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold">{label}</span>
        <span className="font-semibold tnum">{money(p.appliedAmount)}</span>
      </div>
      {p.referenceNumber ? (
        <p className="text-xs text-mute">Ref: <span className="font-mono">{p.referenceNumber}</span></p>
      ) : (
        <div className="mt-1">
          <p className="mb-1 text-xs font-semibold text-warning-deep">No transaction number yet</p>
          <ReferenceEditor paymentId={p.id} onSaved={onChanged} compact />
        </div>
      )}
      {p.reportedByWaiter && <p className="text-xs text-mute">Taken at the table by {p.receivedByName ?? 'a waiter'}</p>}
      {toCents(p.changeAmount) > 0 && (
        <p className="text-xs font-semibold text-warning-deep">
          Customer sent {money(p.tenderedAmount)} ·{' '}
          {p.reportedByWaiter ? `✓ Received gives ${money(p.changeAmount)} change from your drawer` : `${money(p.changeAmount)} change given from the drawer`}
        </p>
      )}
      {(p.hasEvidence ?? hasProof) &&
        (p.hasEvidence ? (
          <a href={`/api/v1/payments/${p.id}/evidence`} target="_blank" rel="noreferrer" className="mt-1 block" title="Open the photo full size">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/v1/payments/${p.id}/evidence`} alt="Customer’s payment screenshot" className="max-h-44 w-full rounded-md border border-line bg-canvas-soft object-contain" loading="lazy" />
          </a>
        ) : (
          <p className="text-xs text-mute">No screenshot attached.</p>
        ))}
      {!can('payment.confirm') ? (
        <p className="mt-1 text-xs text-mute">A manager needs to verify this one.</p>
      ) : rejecting ? (
        <div className="mt-2 flex flex-col gap-2">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why? e.g. not in the statement" maxLength={300} autoFocus />
          <div className="flex gap-2">
            <Button size="sm" variant="danger" onClick={reject} disabled={busy || !reason.trim()}>Mark not received</Button>
            <Button size="sm" variant="ghost" onClick={() => setRejecting(false)} disabled={busy}>Back</Button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex gap-2">
          <Button size="sm" onClick={confirm} disabled={busy}>
            <Icon name="check" size={16} /> Received
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setRejecting(true)} disabled={busy}>
            Not received
          </Button>
        </div>
      )}
    </div>
  );
}
