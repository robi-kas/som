'use client';

import { useEffect, useState } from 'react';
import { api, errorText } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { fromCents, money, toCents, METHOD_LABEL } from '@/lib/format';
import { Sheet } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { useApproval } from '@/components/approval/ApprovalProvider';
import type { Shift } from '@/lib/types';

// Ethiopian birr notes and coins.
const DENOMS = ['200', '100', '50', '10', '5', '1', '0.50', '0.25', '0.10', '0.05'];

interface ShiftReport {
  kind: 'X' | 'Z';
  cashierName: string;
  openedAt: string;
  payments: { method: string; name?: string; count: number; total: string; pendingVerification: string }[];
  totalTaken: string;
  refunds: { count: number; total: string };
  cash: {
    openingFloat: string;
    sales: string;
    refunds: string;
    deposits: string;
    withdrawals: string;
    changeForTransfers?: string;
    expected: string;
    counted: string | null;
    variance: string | null;
  };
}

/**
 * The cashier's drawer: live X report, cash in/out, and blind close by denomination.
 * If the count doesn't match, a manager signs off with their PIN right here.
 */
export function DrawerSheet({ shift, open, onClose, onClosed }: { shift: Shift; open: boolean; onClose: () => void; onClosed: () => void }) {
  const { t } = useT();
  const toast = useToast();
  const approve = useApproval();
  const [report, setReport] = useState<ShiftReport | null>(null);
  const [mode, setMode] = useState<'report' | 'count' | 'result'>('report');
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ reconciliation: { expectedCash: string; actualCash: string; variance: string; status: string } } | null>(null);
  const [busy, setBusy] = useState(false);
  const [move, setMove] = useState<{ type: 'CASH_DEPOSIT' | 'CASH_WITHDRAWAL'; amount: string; reason: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setMode('report');
    setCounts({});
    api.get<ShiftReport>(`/shifts/${shift.id}/report`).then(setReport).catch((e) => toast(errorText(e), 'error'));
  }, [open, shift.id, toast]);

  const counted = DENOMS.reduce((a, d) => a + toCents(d) * (parseInt(counts[d] || '0', 10) || 0), 0);

  const close = async () => {
    setBusy(true);
    try {
      const res = await api.post<typeof result>(`/shifts/${shift.id}/close`, {
        cashCounts: DENOMS.filter((d) => parseInt(counts[d] || '0', 10) > 0).map((d) => ({ value: d, count: parseInt(counts[d], 10) })),
      });
      setResult(res);
      setMode('result');
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const signOff = async () => {
    const token = await approve('shift.approve_variance');
    if (!token) return;
    try {
      await api.post(`/shifts/${shift.id}/approve-variance`, { reason: 'Signed off at close' }, { headers: { 'X-Approval-Token': token } });
      toast('Drawer closed');
      onClosed();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };

  const saveMove = async () => {
    if (!move) return;
    try {
      await api.post(`/shifts/${shift.id}/cash-movement`, move);
      toast(move.type === 'CASH_DEPOSIT' ? 'Cash added' : 'Cash removed');
      setMove(null);
      setReport(await api.get<ShiftReport>(`/shifts/${shift.id}/report`));
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={mode === 'count' ? t('cashier.countDrawer') : 'Drawer'} wide>
      {mode === 'report' && report && (
        <div className="flex flex-col gap-5 pb-2">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Taken this shift" value={money(report.totalTaken)} />
            <Stat label="Cash expected in drawer" value={money(report.cash.expected)} strong />
          </div>
          <table className="w-full text-sm tnum">
            <tbody>
              {report.payments.map((p) => (
                <tr key={p.method} className="border-b border-line-soft">
                  <td className="py-2">{p.name ?? METHOD_LABEL[p.method] ?? p.method}</td>
                  <td className="py-2 text-right text-mute">{p.count}×</td>
                  <td className="py-2 text-right font-semibold">{money(p.total)}</td>
                  <td className="py-2 text-right text-xs text-info">{Number(p.pendingVerification) > 0 ? `+${money(p.pendingVerification)} pending` : ''}</td>
                </tr>
              ))}
              <tr className="text-mute">
                <td className="py-2">Opening float</td>
                <td />
                <td className="py-2 text-right">{money(report.cash.openingFloat)}</td>
                <td />
              </tr>
              {(
                [
                  ['Cash refunds', report.cash.refunds, '−'],
                  ['Cash added', report.cash.deposits, '+'],
                  ['Cash taken out', report.cash.withdrawals, '−'],
                  ['Cash change for transfers', report.cash.changeForTransfers, '−'],
                ] as const
              )
                .filter(([, v]) => Number(v ?? 0) > 0)
                .map(([label, v, sign]) => (
                  <tr key={label} className="text-mute">
                    <td className="py-2">{label}</td>
                    <td />
                    <td className="py-2 text-right">
                      {sign}
                      {money(v ?? '0')}
                    </td>
                    <td />
                  </tr>
                ))}
            </tbody>
          </table>
          {move ? (
            <div className="flex flex-col gap-2 rounded-lg bg-canvas-soft p-3">
              <p className="text-sm font-semibold">{move.type === 'CASH_DEPOSIT' ? 'Add cash to drawer' : 'Take cash out (e.g. to the safe)'}</p>
              <div className="flex gap-2">
                <Input id="move-amount" inputMode="decimal" placeholder="Amount" value={move.amount} onChange={(e) => setMove({ ...move, amount: e.target.value.replace(/[^\d.]/g, '') })} />
                <Input id="move-reason" placeholder="Reason" value={move.reason} onChange={(e) => setMove({ ...move, reason: e.target.value })} />
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setMove(null)}>
                  {t('common.cancel')}
                </Button>
                <Button onClick={saveMove} disabled={!move.amount || !move.reason}>
                  {t('common.save')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setMove({ type: 'CASH_DEPOSIT', amount: '', reason: '' })}>
                Cash in
              </Button>
              <Button variant="outline" onClick={() => setMove({ type: 'CASH_WITHDRAWAL', amount: '', reason: '' })}>
                Cash out
              </Button>
              <Button variant="dark" className="ml-auto" onClick={() => setMode('count')}>
                {t('cashier.closeShift')}
              </Button>
            </div>
          )}
        </div>
      )}

      {mode === 'count' && (
        <div className="flex flex-col gap-4 pb-2">
          <p className="text-sm text-mute">Count every note and coin. Don’t look at the expected amount first — a blind count catches mistakes.</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
            {DENOMS.map((d) => (
              <label key={d} className="flex items-center gap-2">
                <span className="w-14 shrink-0 text-right font-display font-bold tnum">{Number(d) >= 1 ? Number(d) : `${Math.round(Number(d) * 100)}¢`}</span>
                <span className="text-mute">×</span>
                <Input
                  id={`denom-${d}`}
                  inputMode="numeric"
                  className="h-11"
                  value={counts[d] ?? ''}
                  onChange={(e) => setCounts({ ...counts, [d]: e.target.value.replace(/\D/g, '') })}
                />
              </label>
            ))}
          </div>
          <div className="flex items-baseline justify-between rounded-lg bg-ink px-4 py-3 text-white">
            <span className="text-sm text-[#b9bdb4]">Counted</span>
            <span className="font-display text-display-md tnum">{money(fromCents(counted))}</span>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setMode('report')}>
              {t('common.back')}
            </Button>
            <Button size="lg" className="flex-1" onClick={close} loading={busy}>
              {t('cashier.closeShift')}
            </Button>
          </div>
        </div>
      )}

      {mode === 'result' && result && (
        <div className="flex flex-col gap-4 pb-2">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Expected" value={money(result.reconciliation.expectedCash)} />
            <Stat label="Counted" value={money(result.reconciliation.actualCash)} />
            <Stat
              label={Number(result.reconciliation.variance) === 0 ? 'Balanced' : Number(result.reconciliation.variance) > 0 ? 'Over' : 'Short'}
              value={money(result.reconciliation.variance, { sign: true })}
              tone={Number(result.reconciliation.variance) === 0 ? 'good' : 'bad'}
            />
          </div>
          {result.reconciliation.status === 'PENDING' ? (
            <>
              <p className="rounded-md bg-warning-bg p-3 text-sm text-warning-deep">The drawer doesn’t match. A manager must check it and sign off.</p>
              <Button size="xl" variant="dark" onClick={signOff}>
                Manager sign-off
              </Button>
              <Button variant="ghost" onClick={onClosed}>
                Leave it for the manager
              </Button>
            </>
          ) : (
            <Button size="xl" onClick={onClosed}>
              Done
            </Button>
          )}
        </div>
      )}
    </Sheet>
  );
}

function Stat({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: 'good' | 'bad' }) {
  return (
    <div className={`rounded-lg p-3 ${strong ? 'bg-ink text-white' : tone === 'bad' ? 'bg-negative-bg text-negative' : tone === 'good' ? 'bg-positive-bg text-positive' : 'bg-canvas-soft'}`}>
      <p className={`text-xs ${strong ? 'text-[#b9bdb4]' : 'text-mute'}`}>{label}</p>
      <p className="font-display text-display-sm tnum">{value}</p>
    </div>
  );
}
