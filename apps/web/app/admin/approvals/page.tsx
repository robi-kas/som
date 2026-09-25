'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { api, errorText } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useLive } from '@/lib/live';
import { clock, dateLabel, money, METHOD_LABEL } from '@/lib/format';
import { PageHeader } from '@/components/admin/AdminShell';
import { Segmented } from '@/components/ui/Segmented';
import { Button } from '@/components/ui/Button';
import { Empty } from '@/components/ui/Empty';
import { Sheet } from '@/components/ui/Sheet';
import { Input } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { MethodLogo } from '@/components/payments/MethodLogo';

type Tab = 'payments' | 'refunds' | 'drawers' | 'sync';

interface PendingPayment {
  id: string;
  method: string;
  methodName?: string;
  appliedAmount: string;
  referenceNumber: string | null;
  createdAt: string;
  orderNumber: string;
  tableName: string;
  receivedByName: string;
  hasEvidence: boolean;
  canVerify: boolean;
}
interface PendingRefund {
  id: string;
  amount: string;
  method: string;
  reason: string;
  orderNumber: string;
  initiatedByName: string;
  canApprove: boolean;
  createdAt: string;
}
interface PendingDrawer {
  id: string;
  cashierName: string;
  closedAt: string | null;
  expected: string | null;
  counted: string | null;
  variance: string | null;
}
interface Conflict {
  id: string;
  serverEntityId: string | null;
  errorMessage: string | null;
  clientTimestamp: string;
  deviceId: string;
}

function ApprovalsScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const { branchId, can } = useSession();
  const toast = useToast();
  const tab = (params.get('tab') as Tab) || 'payments';
  const [payments, setPayments] = useState<PendingPayment[]>([]);
  const [refunds, setRefunds] = useState<PendingRefund[]>([]);
  const [drawers, setDrawers] = useState<PendingDrawer[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [evidence, setEvidence] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<PendingPayment | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!branchId) return;
    const safe = async <T,>(fn: () => Promise<T>, fallback: T) => {
      try {
        return await fn();
      } catch {
        return fallback;
      }
    };
    const [p, r, d, c] = await Promise.all([
      safe(() => api.get<PendingPayment[]>(`/payments/pending?branchId=${branchId}`), []),
      can('refund.approve') ? safe(() => api.get<PendingRefund[]>(`/refunds/pending?branchId=${branchId}`), []) : Promise.resolve([]),
      can('shift.approve_variance') ? safe(() => api.get<PendingDrawer[]>(`/shifts/pending-variances?branchId=${branchId}`), []) : Promise.resolve([]),
      can('sync.resolve_conflict') ? safe(() => api.get<Conflict[]>(`/sync/conflicts?branchId=${branchId}`), []) : Promise.resolve([]),
    ]);
    setPayments(p);
    setRefunds(r);
    setDrawers(d);
    setConflicts(c);
  }, [branchId, can]);

  useEffect(() => {
    load();
  }, [load]);
  useLive(branchId, ['payment.updated', 'order.updated', 'shift.updated'], () => load(), 30_000);

  const run = async (id: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(id);
    try {
      await fn();
      toast(ok);
      await load();
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  const setTab = (t: Tab) => router.replace(`/admin/approvals?tab=${t}`);

  return (
    <div className="pb-10">
      <PageHeader title="Needs attention" sub="Things only a manager can sign off. Every decision is logged with your name." />
      <div className="px-4 sm:px-8">
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'payments', label: 'Payments to verify', badge: payments.length },
            { value: 'refunds', label: 'Refunds', badge: refunds.length },
            { value: 'drawers', label: 'Drawers', badge: drawers.length },
            { value: 'sync', label: 'Offline clashes', badge: conflicts.length },
          ]}
        />

        <div className="mt-5 overflow-hidden rounded-xl border border-line bg-canvas">
          {tab === 'payments' &&
            (payments.length === 0 ? (
              <Empty title="All verified">Telebirr, CBE Birr and bank transfers wait here until someone checks the statement.</Empty>
            ) : (
              <ul>
                {payments.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-4 border-b border-line-soft px-5 py-4 last:border-0">
                    <MethodLogo code={p.method} name={p.methodName ?? p.method} size={40} />
                    <div className="min-w-[12rem] flex-1">
                      <p className="font-semibold">
                        {money(p.appliedAmount)} ETB · {p.methodName ?? METHOD_LABEL[p.method] ?? p.method}
                      </p>
                      {p.referenceNumber ? <p className="font-mono text-sm">Ref {p.referenceNumber}</p> : <p className="text-sm font-semibold text-warning-deep">No transaction number yet</p>}
                      <p className="text-xs text-mute">
                        {p.tableName} #{p.orderNumber} · taken by {p.receivedByName} at {clock(p.createdAt)}
                      </p>
                    </div>
                    {p.hasEvidence && (
                      <Button variant="outline" size="sm" onClick={() => setEvidence(p.id)}>
                        Screenshot
                      </Button>
                    )}
                    {p.canVerify ? (
                      <div className="flex gap-2">
                        <Button variant="ghost" size="md" onClick={() => { setReason(''); setRejecting(p); }}>
                          Not received
                        </Button>
                        <Button size="md" loading={busy === p.id} onClick={() => run(p.id, () => api.post(`/payments/${p.id}/confirm`), 'Verified — receipt printing')}>
                          It’s on the statement
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-mute">You took this one — someone else must verify it</span>
                    )}
                  </li>
                ))}
              </ul>
            ))}

          {tab === 'refunds' &&
            (refunds.length === 0 ? (
              <Empty title="No refunds waiting">Refunds above the cashier limit wait here for approval.</Empty>
            ) : (
              <ul>
                {refunds.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-4 border-b border-line-soft px-5 py-4 last:border-0">
                    <div className="flex-1">
                      <p className="font-semibold">
                        {money(r.amount)} ETB · {METHOD_LABEL[r.method] ?? r.method}
                      </p>
                      <p className="text-sm text-body">“{r.reason}”</p>
                      <p className="text-xs text-mute">
                        Order #{r.orderNumber} · asked by {r.initiatedByName} · {dateLabel(r.createdAt)} {clock(r.createdAt)}
                      </p>
                    </div>
                    {r.canApprove ? (
                      <Button loading={busy === r.id} onClick={() => run(r.id, () => api.post(`/refunds/${r.id}/approve`), 'Approved — the cashier can pay it out')}>
                        Approve
                      </Button>
                    ) : (
                      <span className="text-xs text-mute">You asked for this one</span>
                    )}
                  </li>
                ))}
              </ul>
            ))}

          {tab === 'drawers' &&
            (drawers.length === 0 ? (
              <Empty title="All drawers balanced" />
            ) : (
              <ul>
                {drawers.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-4 border-b border-line-soft px-5 py-4 last:border-0">
                    <div className="flex-1">
                      <p className="font-semibold">{d.cashierName}</p>
                      <p className="text-sm text-body tnum">
                        Expected {money(d.expected)} · counted {money(d.counted)} ·{' '}
                        <span className={Number(d.variance) < 0 ? 'font-bold text-negative' : 'font-bold text-positive'}>{money(d.variance, { sign: true })}</span>
                      </p>
                      <p className="text-xs text-mute">{d.closedAt ? `Closed ${dateLabel(d.closedAt)} ${clock(d.closedAt)}` : ''}</p>
                    </div>
                    <Button
                      loading={busy === d.id}
                      onClick={() => run(d.id, () => api.post(`/shifts/${d.id}/approve-variance`, { reason: 'Checked by manager' }), 'Signed off')}
                    >
                      Sign off
                    </Button>
                  </li>
                ))}
              </ul>
            ))}

          {tab === 'sync' &&
            (conflicts.length === 0 ? (
              <Empty title="No clashes">When a waiter orders offline for a table someone else seated, it shows up here.</Empty>
            ) : (
              <ul>
                {conflicts.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-4 border-b border-line-soft px-5 py-4 last:border-0">
                    <div className="flex-1">
                      <p className="font-semibold">Offline order from {dateLabel(c.clientTimestamp)} {clock(c.clientTimestamp)}</p>
                      <p className="text-xs text-mute">The table already had an order. The offline one was kept aside without a table.</p>
                    </div>
                    <Button variant="ghost" loading={busy === c.id + 'r'} onClick={() => run(c.id + 'r', () => api.post(`/sync/conflicts/${c.id}/resolve`, { resolution: 'REJECT_LOCAL' }), 'Offline order cancelled')}>
                      Cancel it
                    </Button>
                    <Button loading={busy === c.id + 'a'} onClick={() => run(c.id + 'a', () => api.post(`/sync/conflicts/${c.id}/resolve`, { resolution: 'ACCEPT_LOCAL' }), 'Sent to kitchen as a separate order')}>
                      Keep & send to kitchen
                    </Button>
                  </li>
                ))}
              </ul>
            ))}
        </div>
      </div>

      <Sheet open={!!evidence} onClose={() => setEvidence(null)} title="Payment screenshot" wide>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {evidence && <img src={`/api/v1/payments/${evidence}/evidence`} alt="Customer's payment screenshot" className="mx-auto max-h-[70vh] rounded-md" />}
      </Sheet>

      <Sheet
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        title="Payment not received"
        footer={
          <Button
            variant="danger"
            size="lg"
            block
            className="mb-1"
            disabled={reason.trim().length < 3}
            onClick={() =>
              rejecting &&
              run(rejecting.id, () => api.post(`/payments/${rejecting.id}/reject`, { reason: reason.trim() }), 'Rejected — the bill is open again').then(() => setRejecting(null))
            }
          >
            Reject payment
          </Button>
        }
      >
        <p className="mb-3 text-sm text-body">The bill goes back to owing {money(rejecting?.appliedAmount)} ETB and the cashier sees it again.</p>
        <Input id="reject-reason" placeholder="What did you check? e.g. not on Telebirr statement at 14:30" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Sheet>
    </div>
  );
}

export default function ApprovalsPage() {
  return (
    <Suspense>
      <ApprovalsScreen />
    </Suspense>
  );
}
