'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errorText } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { useLive } from '@/lib/live';
import { fromCents, money, toCents } from '@/lib/format';
import { AppShell } from '@/components/shell/AppShell';
import { MethodLogo } from '@/components/payments/MethodLogo';
import { ReferenceEditor } from '@/components/cashier/ReferenceEditor';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Pill, type Tone } from '@/components/ui/Pill';
import { Segmented } from '@/components/ui/Segmented';
import { Sheet } from '@/components/ui/Sheet';
import { PageSpinner, LoadFailed } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';

interface HistoryRow {
  id: string;
  orderId: string;
  orderNumber: string;
  tableName: string;
  method: string;
  methodName: string;
  payerBank: string | null;
  status: string;
  appliedAmount: string;
  tenderedAmount: string;
  changeAmount: string;
  referenceNumber: string | null;
  receivedByName: string | null;
  verifiedByName: string | null;
  rejectedReason: string | null;
  refundableAmount: string;
  hasEvidence: boolean;
  reportedByWaiter?: boolean;
  createdAt: string;
}

type Filter = 'all' | 'digital' | 'missing' | 'waiting';

const STATUS: Record<string, { label: string; tone: Tone }> = {
  CONFIRMED: { label: 'Received', tone: 'good' },
  PENDING_VERIFICATION: { label: 'Not checked yet', tone: 'warn' },
  REJECTED: { label: 'Not received', tone: 'bad' },
  PARTIALLY_REFUNDED: { label: 'Part refunded', tone: 'info' },
  FULLY_REFUNDED: { label: 'Refunded', tone: 'info' },
};

const isDigital = (r: HistoryRow) => r.method !== 'CASH' && r.method !== 'CARD';
const counted = (r: HistoryRow) => r.status !== 'REJECTED' && r.status !== 'PENDING_VERIFICATION';

/** "2026-09-25" for a local date, and the [start, end) of that day as ISO strings. */
function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function dayRange(key: string) {
  const [y, m, d] = key.split('-').map(Number);
  const from = new Date(y, m - 1, d);
  const to = new Date(y, m - 1, d + 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

export default function PaymentsHistoryPage() {
  const { branchId, can } = useSession();
  const { t } = useT();
  const toast = useToast();
  const [day, setDay] = useState(() => dayKey(new Date()));
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [photo, setPhoto] = useState<HistoryRow | null>(null);

  const load = useCallback(async () => {
    if (!branchId) return;
    try {
      setFailed(null);
      const { from, to } = dayRange(day);
      setRows(await api.get<HistoryRow[]>(`/payments/history?branchId=${branchId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`));
    } catch (e) {
      setFailed(errorText(e));
    }
  }, [branchId, day]);

  useEffect(() => {
    setRows(null);
    load();
  }, [load]);
  const live = useLive(branchId, ['payment.updated', 'order.updated'], () => load());

  const today = dayKey(new Date());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000));

  // Totals per method: what actually arrived (not rejected, not still unchecked).
  const totals = useMemo(() => {
    const map = new Map<string, { method: string; name: string; cents: number; count: number }>();
    for (const r of rows ?? []) {
      if (!counted(r)) continue;
      const cur = map.get(r.method) ?? { method: r.method, name: r.methodName.split(':')[0], cents: 0, count: 0 };
      cur.cents += toCents(r.appliedAmount);
      cur.count += 1;
      map.set(r.method, cur);
    }
    return [...map.values()].sort((a, b) => b.cents - a.cents);
  }, [rows]);
  const grand = totals.reduce((a, x) => a + x.cents, 0);

  const counts = useMemo(
    () => ({
      missing: (rows ?? []).filter((r) => isDigital(r) && !r.referenceNumber && r.status !== 'REJECTED').length,
      waiting: (rows ?? []).filter((r) => r.status === 'PENDING_VERIFICATION').length,
    }),
    [rows],
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows ?? []).filter((r) => {
      if (filter === 'digital' && !isDigital(r)) return false;
      if (filter === 'missing' && !(isDigital(r) && !r.referenceNumber && r.status !== 'REJECTED')) return false;
      if (filter === 'waiting' && r.status !== 'PENDING_VERIFICATION') return false;
      if (!q) return true;
      return [r.referenceNumber, r.tableName, r.orderNumber, r.methodName, r.payerBank, r.receivedByName].some((v) => v?.toLowerCase().includes(q));
    });
  }, [rows, filter, query]);

  const uploadPhoto = async (r: HistoryRow, file: File) => {
    const form = new FormData();
    form.append('file', file);
    try {
      await api.upload(`/payments/${r.id}/evidence`, form);
      toast('Screenshot attached', 'ok');
      load();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };

  return (
    <AppShell live={live} title={t('nav.payments')}>
      <div className="mx-auto flex h-full max-w-5xl flex-col gap-4 overflow-y-auto p-4 sm:p-6">
        {/* Day picker */}
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="mr-auto font-display text-display-md">Payments</h1>
          <Button size="sm" variant={day === today ? 'dark' : 'outline'} onClick={() => setDay(today)}>
            Today
          </Button>
          <Button size="sm" variant={day === yesterday ? 'dark' : 'outline'} onClick={() => setDay(yesterday)}>
            Yesterday
          </Button>
          <input
            type="date"
            value={day}
            max={today}
            onChange={(e) => e.target.value && setDay(e.target.value)}
            aria-label="Pick a day"
            className="h-9 rounded-md border border-line bg-canvas px-2 text-sm"
          />
        </div>

        {failed ? (
          <LoadFailed message={failed} onRetry={load} />
        ) : !rows ? (
          <PageSpinner />
        ) : (
          <>
            {/* Totals by method */}
            <section className="rounded-xl border border-line bg-canvas p-4">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-xs font-bold uppercase tracking-wider text-mute">Received {day === today ? 'today' : 'this day'}</h2>
                <span className="font-display text-display-md tnum">{money(fromCents(grand))}</span>
              </div>
              {totals.length === 0 ? (
                <p className="mt-2 text-sm text-mute">No payments yet.</p>
              ) : (
                <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {totals.map((x) => (
                    <li key={x.method} className="flex items-center gap-3 rounded-lg bg-canvas-soft p-2 pr-3">
                      <MethodLogo code={x.method} name={x.name} size={36} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{x.name}</span>
                        <span className="text-xs text-mute">
                          {x.count} payment{x.count === 1 ? '' : 's'}
                        </span>
                      </span>
                      <span className="font-semibold tnum">{money(fromCents(x.cents))}</span>
                    </li>
                  ))}
                </ul>
              )}
              {counts.waiting > 0 && <p className="mt-3 text-xs text-mute">{counts.waiting} not checked yet — not counted until someone confirms the money arrived.</p>}
            </section>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-2">
              <Segmented
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'digital', label: 'Telebirr & bank' },
                  { value: 'missing', label: 'No transaction no.', badge: counts.missing || undefined },
                  { value: 'waiting', label: 'Not checked', badge: counts.waiting || undefined },
                ]}
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search transaction no., table, bill…"
                aria-label="Search payments"
                className="h-10 min-w-0 flex-1 rounded-md border border-line bg-canvas px-3 text-sm outline-none focus:border-ink sm:max-w-xs"
              />
            </div>

            {/* List */}
            <ul className="flex flex-col gap-2 pb-6">
              {shown.length === 0 && <li className="rounded-xl border border-line bg-canvas px-4 py-10 text-center text-sm text-mute">Nothing here.</li>}
              {shown.map((r) => {
                const st = STATUS[r.status] ?? { label: r.status, tone: 'neutral' as Tone };
                const needsRef = isDigital(r) && !r.referenceNumber && r.status !== 'REJECTED';
                return (
                  <li key={r.id} className={`rounded-xl border bg-canvas p-3 sm:p-4 ${needsRef ? 'border-warning-deep/40' : 'border-line'}`}>
                    <div className="flex items-start gap-3">
                      <MethodLogo code={r.method} name={r.payerBank ?? r.methodName} size={44} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                          <p className="font-semibold">
                            {r.methodName}
                            <span className="font-normal text-mute"> · {r.tableName} · #{r.orderNumber.split('-').pop()}</span>
                          </p>
                          <p className={`font-display text-lg font-black tnum ${r.status === 'REJECTED' ? 'text-mute line-through' : ''}`}>{money(r.appliedAmount)}</p>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-mute">
                          <Pill tone={st.tone}>{st.label}</Pill>
                          <span className="tnum">{new Date(r.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          {r.receivedByName && <span>· taken by {r.receivedByName}{r.reportedByWaiter ? ' at the table' : ''}</span>}
                          {r.verifiedByName && <span>· checked by {r.verifiedByName}</span>}
                          {toCents(r.changeAmount) > 0 && (
                            <span>
                              · {r.method === 'CASH' ? 'paid' : 'sent'} {money(r.tenderedAmount)}, change {money(r.changeAmount)}
                              {r.method !== 'CASH' && ' from the drawer'}
                            </span>
                          )}
                        </div>
                        {r.rejectedReason && <p className="mt-1 text-xs text-negative">Why: {r.rejectedReason}</p>}

                        {/* Transaction number */}
                        {isDigital(r) && (
                          <div className="mt-2">
                            {editing === r.id || needsRef ? (
                              <div className="flex flex-col gap-1">
                                {needsRef && <span className="text-xs font-semibold text-warning-deep">Write the transaction number from the customer’s SMS / bank app</span>}
                                <ReferenceEditor
                                  paymentId={r.id}
                                  initial={r.referenceNumber ?? ''}
                                  compact
                                  onCancel={editing === r.id ? () => setEditing(null) : undefined}
                                  onSaved={() => {
                                    setEditing(null);
                                    load();
                                  }}
                                />
                              </div>
                            ) : (
                              <div className="flex flex-wrap items-center gap-2 text-sm">
                                <span className="text-mute">Transaction no.</span>
                                <span className="rounded bg-canvas-soft px-2 py-0.5 font-mono font-semibold">{r.referenceNumber}</span>
                                {r.status !== 'REJECTED' && can('payment.confirm') && (
                                  <button onClick={() => setEditing(r.id)} className="text-xs font-semibold underline">
                                    Edit
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Screenshot */}
                    {isDigital(r) && (r.hasEvidence || r.status === 'PENDING_VERIFICATION') && (
                      <div className="mt-3 flex gap-2 border-t border-line-soft pt-3">
                        {r.hasEvidence ? (
                          <Button size="sm" variant="outline" onClick={() => setPhoto(r)}>
                            <Icon name="camera" size={16} /> See screenshot
                          </Button>
                        ) : (
                          <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-line px-3 text-sm font-semibold hover:border-ink">
                            <Icon name="camera" size={16} /> Add screenshot
                            <input
                              type="file"
                              accept="image/png,image/jpeg,image/webp"
                              className="sr-only"
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) uploadPhoto(r, f);
                                e.target.value = '';
                              }}
                            />
                          </label>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      <Sheet open={!!photo} onClose={() => setPhoto(null)} title={photo ? `${photo.methodName} · ${money(photo.appliedAmount)}` : ''} wide>
        {photo && (
          <div className="flex flex-col gap-3">
            {photo.referenceNumber && (
              <p className="text-sm">
                Transaction no. <span className="font-mono font-semibold">{photo.referenceNumber}</span>
              </p>
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/v1/payments/${photo.id}/evidence`} alt="Customer’s payment screenshot" className="mx-auto max-h-[70vh] rounded-md" />
          </div>
        )}
      </Sheet>
    </AppShell>
  );
}
