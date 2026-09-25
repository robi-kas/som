'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, errorText, newIdempotencyKey } from '@/lib/api';
import { useSession } from '@/lib/session';
import { fromCents, money, toCents } from '@/lib/format';
import type { OrderDetail, RefundRow } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { Pill } from '@/components/ui/Pill';
import { useToast } from '@/components/ui/Toast';

const REFUND_ERRORS: Record<string, string> = {
  REFUND_EXCEEDS_REFUNDABLE: 'That is more than is left to give back on this payment.',
  REFUND_AMOUNT_INVALID: 'Enter a valid amount.',
  PAYMENT_NOT_CONFIRMED: 'Only a payment that was received can be refunded.',
  SHIFT_REQUIRED: 'Open your cash drawer first — cash refunds come out of it.',
  INSUFFICIENT_DRAWER_CASH: 'There is not enough cash in the drawer for this refund.',
  SELF_APPROVAL_FORBIDDEN: 'A different manager has to approve a refund they started.',
  APPROVAL_CANCELLED: 'Cancelled — the refund is saved and waits for a manager.',
};
const refundError = (e: unknown) => (e instanceof ApiError && e.code && REFUND_ERRORS[e.code]) || errorText(e);

const STATUS: Record<string, { label: string; tone: 'neutral' | 'warn' | 'good' }> = {
  PENDING: { label: 'Waiting', tone: 'warn' },
  APPROVED: { label: 'Approved — pay out', tone: 'warn' },
  CONFIRMED: { label: 'Paid back', tone: 'good' },
};

/**
 * Refunds for a closed bill. The cashier starts one; small refunds are paid out at once,
 * bigger ones pop up the manager PIN pad (or wait on the Approvals page) before paying out.
 */
export function RefundPanel({ order, onChanged }: { order: OrderDetail; onChanged: () => void }) {
  const { can } = useSession();
  const toast = useToast();
  const [refunds, setRefunds] = useState<RefundRow[]>([]);
  const refundable = order.payments.filter((p) => (p.status === 'CONFIRMED' || p.status === 'PARTIALLY_REFUNDED') && toCents(p.refundableAmount ?? '0') > 0);
  const [paymentId, setPaymentId] = useState(refundable[0]?.id ?? '');
  const payment = refundable.find((p) => p.id === paymentId) ?? refundable[0];
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get<RefundRow[]>(`/orders/${order.id}/refunds`).then(setRefunds).catch(() => setRefunds([]));
  }, [order.id]);
  useEffect(load, [load]);
  useEffect(() => {
    setAmount('');
    setReason('');
  }, [order.id]);

  // Money still promised in refunds that aren't paid yet can't be promised twice.
  const heldCents = refunds.filter((r) => r.paymentId === payment?.id && r.status !== 'CONFIRMED').reduce((a, r) => a + toCents(r.amount), 0);
  const maxCents = payment ? Math.max(0, toCents(payment.refundableAmount ?? '0') - heldCents) : 0;
  const parsed = amount ? toCents(amount) : 0;
  const amountCents = Number.isNaN(parsed) ? 0 : parsed;

  /** Pay a refund out; if it's above the cashier limit, ask for a manager PIN first. */
  async function payOut(r: RefundRow) {
    try {
      await api.post(`/refunds/${r.id}/confirm`, {}, { headers: { 'Idempotency-Key': newIdempotencyKey() } });
    } catch (e) {
      if (!(e instanceof ApiError && e.code === 'REFUND_NOT_READY_TO_CONFIRM')) throw e;
      await api.post(`/refunds/${r.id}/approve`); // opens the manager PIN pad
      await api.post(`/refunds/${r.id}/confirm`, {}, { headers: { 'Idempotency-Key': newIdempotencyKey() } });
    }
    toast(`${money(r.amount)} refunded${r.method === 'CASH' ? ' — give the cash back from the drawer' : ''}`, 'ok');
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast(refundError(e), 'error');
    } finally {
      setBusy(false);
      load();
      onChanged();
    }
  }

  const submit = () =>
    run(async () => {
      if (!payment) return;
      const r = await api.post<RefundRow>(
        `/orders/${order.id}/refunds`,
        { paymentId: payment.id, method: payment.method, amount: fromCents(amountCents), reason: reason.trim() },
        { headers: { 'Idempotency-Key': newIdempotencyKey() } },
      );
      setAmount('');
      setReason('');
      if (can('refund.confirm')) await payOut(r);
      else toast('Refund requested — a cashier or manager will pay it out', 'ok');
    });

  return (
    <div className="flex flex-col gap-4 overflow-y-auto p-5">
      <div>
        <h2 className="font-display text-display-sm">Refund · {order.tableName ?? 'Takeaway'}</h2>
        <p className="text-sm text-mute">
          Bill {order.orderNumber} · {money(order.totalAmount)} paid. The money goes back the same way it was paid.
        </p>
      </div>

      {refunds.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-mute">Refunds on this bill</h3>
          {refunds.map((r) => {
            const st = STATUS[r.status] ?? { label: r.status, tone: 'neutral' as const };
            return (
              <div key={r.id} className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="font-semibold tnum">{money(r.amount)} · {r.method}</p>
                  <p className="truncate text-mute">{r.reason}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Pill tone={st.tone}>{st.label}</Pill>
                  {r.status !== 'CONFIRMED' && can('refund.confirm') && (
                    <Button size="sm" onClick={() => run(() => payOut(r))} disabled={busy}>
                      Pay out
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </section>
      )}

      {!can('refund.create') ? (
        <p className="rounded-md bg-canvas-soft px-3 py-2 text-sm text-mute">You can't start refunds. Ask a cashier or manager.</p>
      ) : refundable.length === 0 ? (
        <p className="rounded-md bg-canvas-soft px-3 py-2 text-sm text-mute">Nothing left to refund on this bill.</p>
      ) : (
        <section className="flex flex-col gap-3 rounded-lg border border-line p-4">
          <h3 className="font-semibold">New refund</h3>
          {refundable.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {refundable.map((p) => (
                <Button key={p.id} size="sm" variant={p.id === payment?.id ? 'dark' : 'outline'} onClick={() => setPaymentId(p.id)}>
                  {p.methodName ?? p.method} · {money(p.refundableAmount ?? '0')}
                </Button>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <label className="flex flex-1 flex-col gap-1 text-sm">
              <span className="font-semibold">Amount (up to {money(fromCents(maxCents))})</span>
              <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} placeholder="0.00" />
            </label>
            <Button variant="outline" onClick={() => setAmount(fromCents(maxCents))}>
              All
            </Button>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold">Why?</span>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. cold coffee, wrong order, charged twice" />
          </label>
          <Button size="lg" variant="danger" onClick={submit} loading={busy} disabled={busy || amountCents <= 0 || amountCents > maxCents || !reason.trim()}>
            Refund {amountCents > 0 ? money(fromCents(amountCents)) : ''}
          </Button>
          <p className="text-xs text-mute">Big refunds ask for a manager's PIN. Every refund is recorded in the activity log.</p>
        </section>
      )}
    </div>
  );
}
