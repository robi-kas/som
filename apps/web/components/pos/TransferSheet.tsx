'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { api, errorText, newIdempotencyKey } from '@/lib/api';
import { useSession } from '@/lib/session';
import { compressPhoto } from '@/lib/image';
import { fromCents, money, toCents } from '@/lib/format';
import type { OrderDetail, PaymentMethodConfig } from '@/lib/types';
import { MethodLogo } from '@/components/payments/MethodLogo';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Field';
import { Sheet } from '@/components/ui/Sheet';
import { useToast } from '@/components/ui/Toast';

/**
 * The waiter's "customer paid by transfer" flow, on their phone at the table:
 *   1. which app/bank   2. how much they sent (the number on their screen); the app works out
 *      whether it's the whole bill, part of it (rest at the till) or more (change at the till)
 *   4. photo of the "payment successful" screen   5. transaction number (can be added later)
 * It goes to the cashier as "not checked yet"; only the cashier can say the money arrived.
 */
export function TransferSheet({ open, onClose, order, onDone }: { open: boolean; onClose: () => void; order: OrderDetail; onDone: () => void }) {
  const { branchId, branch } = useSession();
  const toast = useToast();
  const photoRequired = branch?.waiterPhotoRequired ?? true;

  const pendingCents = order.payments.filter((p) => p.status === 'PENDING_VERIFICATION').reduce((a, p) => a + toCents(p.appliedAmount), 0);
  const dueCents = Math.max(0, toCents(order.balanceDue) - pendingCents);

  const [methods, setMethods] = useState<PaymentMethodConfig[] | null>(null);
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(''); // what the customer transferred, read off their screen
  const [payerBank, setPayerBank] = useState('');
  const [reference, setReference] = useState('');
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const idem = useRef(newIdempotencyKey());

  useEffect(() => {
    if (!open || !branchId) return;
    setCode('');
    setSent('');
    setPayerBank('');
    setReference('');
    setPhoto(null);
    setPreview(null);
    idem.current = newIdempotencyKey();
    api
      .get<PaymentMethodConfig[]>(`/payment-methods?branchId=${branchId}`)
      .then((all) => setMethods(all.filter((m) => m.kind !== 'CASH' && m.kind !== 'CARD')))
      .catch((e) => {
        setMethods([]);
        toast(errorText(e), 'error');
      });
  }, [open, branchId, toast]);

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  const cfg = methods?.find((m) => m.code === code);
  // One number decides everything: less than the bill = part payment, more = change at the till.
  const parsedSent = sent ? toCents(sent) : dueCents;
  const sentCents = Number.isNaN(parsedSent) ? 0 : parsedSent;
  const billCents = Math.min(sentCents, dueCents); // what goes towards the bill
  const changeCents = Math.max(0, sentCents - dueCents);
  const restCents = dueCents - billCents; // still to pay at the till

  const problem = useMemo(() => {
    if (!cfg) return 'Pick how the customer paid';
    if (sent && Number.isNaN(parsedSent)) return 'Enter the amount like 200 or 227.70';
    if (billCents <= 0) return 'Enter how much they sent';
    if (changeCents > billCents) return `That’s ${money(fromCents(changeCents))} change — more than the bill. Check the amount.`;
    if (cfg.askPayerBank && payerBank.trim().length < 2) return 'Which bank did they pay from?';
    if (photoRequired && !photo) return 'Take a photo of their payment screen';
    if (reference.trim() && !/^[A-Za-z0-9\-_/ ]{4,64}$/.test(reference.trim())) return 'The transaction number looks wrong';
    return null;
  }, [cfg, billCents, dueCents, sentCents, changeCents, payerBank, photoRequired, photo, reference]);

  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    try {
      const small = await compressPhoto(file);
      setPhoto(small);
      setPreview((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(small);
      });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not read the photo', 'error');
    }
  };

  const submit = async () => {
    if (problem || !cfg) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('method', cfg.code);
      form.append('appliedAmount', fromCents(billCents));
      if (changeCents > 0) form.append('sentAmount', fromCents(sentCents));
      if (reference.trim()) form.append('referenceNumber', reference.trim());
      if (cfg.askPayerBank) form.append('payerBank', payerBank.trim());
      if (photo) form.append('file', photo, 'payment.jpg');
      await api.upload(`/orders/${order.id}/payments/report`, form, { 'Idempotency-Key': idem.current });
      toast(changeCents > 0 ? `Sent to the cashier. The customer gets ${money(fromCents(changeCents))} change at the till.` : 'Sent to the cashier to check', 'ok');
      onDone();
      onClose();
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Customer paid by transfer"
      footer={
        <div className="flex flex-col gap-2 pb-3">
          {problem && cfg && <p className="text-center text-sm text-mute">{problem}</p>}
          <Button size="xl" block onClick={submit} loading={busy} disabled={!!problem || busy}>
            Send to cashier · {money(fromCents(Math.max(0, billCents)))}
          </Button>
        </div>
      }
    >
      {!methods ? (
        <p className="py-8 text-center text-sm text-mute">Loading…</p>
      ) : methods.length === 0 ? (
        <p className="py-8 text-center text-sm text-mute">No transfer methods are switched on. Ask the owner (Settings → Payment methods).</p>
      ) : (
        <div className="flex flex-col gap-5">
          {/* 1. Method */}
          <section>
            <h3 className="mb-2 text-sm font-semibold">1 · How did they pay?</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {methods.map((m) => (
                <button
                  key={m.code}
                  onClick={() => setCode(m.code)}
                  aria-pressed={code === m.code}
                  className={`flex items-center gap-2 rounded-lg border-2 p-2 text-left text-sm font-semibold ${code === m.code ? 'border-ink bg-primary-pale' : 'border-line bg-canvas hover:border-ink'}`}
                >
                  <MethodLogo code={m.code} name={m.name} size={32} />
                  <span className="min-w-0 leading-tight">{m.name}</span>
                </button>
              ))}
            </div>
            {cfg?.accountInfo && <p className="mt-2 rounded-md bg-canvas-soft px-3 py-2 text-sm">Pay to: <span className="font-mono font-semibold">{cfg.accountInfo}</span></p>}
            {cfg?.askPayerBank && (
              <Input className="mt-2" placeholder="Which bank? e.g. Wegagen, Nib, Siinqee" value={payerBank} onChange={(e) => setPayerBank(e.target.value)} maxLength={60} />
            )}
          </section>

          {/* 2. Amount they sent */}
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">2 · How much did they send?</h3>
            <p className="-mt-1 text-xs text-mute">Type the amount shown on the customer’s phone. Bill left: {money(fromCents(dueCents))}</p>
            <div className="flex gap-2">
              <Input
                inputMode="decimal"
                placeholder={fromCents(dueCents)}
                value={sent}
                onChange={(e) => setSent(e.target.value.replace(/[^\d.]/g, ''))}
                className="font-display text-xl font-black tnum"
                aria-label="Amount the customer sent"
              />
              <Button variant={!sent || parsedSent === dueCents ? 'dark' : 'outline'} onClick={() => setSent(fromCents(dueCents))} className="shrink-0">
                Exact
              </Button>
            </div>
            {billCents > 0 && restCents > 0 && (
              <p className="rounded-md bg-info-bg px-3 py-2 text-sm font-semibold text-info">
                Part payment. The other {money(fromCents(restCents))} is paid at the till (cash or another transfer).
              </p>
            )}
            {changeCents > 0 && changeCents <= billCents && (
              <p className="rounded-md bg-warning-bg px-3 py-2 text-sm font-semibold text-warning-deep">
                {money(fromCents(changeCents))} change — the cashier gives it from the till once the transfer is confirmed.
              </p>
            )}
            {billCents > 0 && restCents === 0 && changeCents === 0 && <p className="text-sm font-semibold text-positive">Pays the whole bill.</p>}
          </section>

          {/* 3. Photo */}
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">
              3 · Photo of their “payment successful” screen {!photoRequired && <span className="font-normal text-mute">(optional)</span>}
            </h3>
            {preview ? (
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview} alt="Payment confirmation photo" className="max-h-72 w-full rounded-lg border border-line bg-canvas-soft object-contain" />
                <label className="absolute bottom-2 right-2 inline-flex h-10 cursor-pointer items-center gap-2 rounded-full bg-ink px-4 text-sm font-semibold text-white">
                  <Icon name="camera" size={16} /> Retake
                  <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => onPhoto(e.target.files?.[0])} />
                </label>
              </div>
            ) : (
              <label className={`flex h-32 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed text-sm font-semibold ${photoRequired ? 'border-warning-deep bg-warning-bg text-warning-deep' : 'border-line text-body'}`}>
                <Icon name="camera" size={28} />
                Tap to take the photo
                <span className="text-xs font-normal">Point the camera at the customer’s phone</span>
                <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => onPhoto(e.target.files?.[0])} />
              </label>
            )}
          </section>

          {/* 4. Reference */}
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">
              4 · Transaction number <span className="font-normal text-mute">(can be added later)</span>
            </h3>
            <Input autoCapitalize="characters" placeholder="e.g. CGH12345XY" value={reference} onChange={(e) => setReference(e.target.value.toUpperCase())} maxLength={64} />
          </section>
        </div>
      )}
    </Sheet>
  );
}
