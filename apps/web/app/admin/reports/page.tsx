'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, errorText } from '@/lib/api';
import { useSession } from '@/lib/session';
import { clock, dateLabel, money, todayIso, METHOD_LABEL } from '@/lib/format';
import { hourLabel, type PeriodReport } from '@/lib/reports';
import { PageHeader, Panel } from '@/components/admin/AdminShell';
import { BarList, ColumnChart, StatTile } from '@/components/admin/Charts';
import { Segmented } from '@/components/ui/Segmented';
import { Input } from '@/components/ui/Field';
import { PageSpinner, LoadFailed } from '@/components/ui/Spinner';
import { Pill } from '@/components/ui/Pill';
import { useToast } from '@/components/ui/Toast';

type Preset = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'custom';

function shift(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function rangeFor(p: Preset): [string, string] {
  const today = todayIso();
  switch (p) {
    case 'yesterday':
      return [shift(today, -1), shift(today, -1)];
    case '7d':
      return [shift(today, -6), today];
    case '30d':
      return [shift(today, -29), today];
    case 'month':
      return [`${today.slice(0, 8)}01`, today];
    default:
      return [today, today];
  }
}

interface Variance {
  shiftId: string;
  cashierName: string;
  openedAt: string;
  status: string;
  expectedCash: string;
  actualCash: string | null;
  variance: string | null;
  varianceStatus: string | null;
}

export default function ReportsPage() {
  const { branchId } = useSession();
  const toast = useToast();
  const [failed, setFailed] = useState<string | null>(null);
  const [preset, setPreset] = useState<Preset>('7d');
  const [[from, to], setRange] = useState<[string, string]>(rangeFor('7d'));
  const [report, setReport] = useState<PeriodReport | null>(null);
  const [variances, setVariances] = useState<Variance[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!branchId || !from || !to || from > to) return;
    setLoading(true);
    try {
      setFailed(null);
      const [r, v] = await Promise.all([
        api.get<PeriodReport>(`/reports/range?branchId=${branchId}&from=${from}&to=${to}`),
        api.get<Variance[]>(`/reports/cash-variance?branchId=${branchId}&from=${from}&to=${to}`),
      ]);
      setReport(r);
      setVariances(v);
    } catch (e) {
      setFailed(errorText(e));
      toast(errorText(e), 'error');
    } finally {
      setLoading(false);
    }
  }, [branchId, from, to, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const pick = (p: Preset) => {
    setPreset(p);
    if (p !== 'custom') setRange(rangeFor(p));
  };

  const singleDay = from === to;

  return (
    <div className="pb-10">
      <PageHeader
        title="Reports"
        sub="Sales count bills when they close; money-in counts payments when they’re confirmed."
        actions={
          <a
            href={`/api/v1/reports/orders.csv?branchId=${branchId}&from=${from}&to=${to}`}
            className="inline-flex h-11 items-center rounded-md border border-line bg-canvas px-4 text-sm font-semibold hover:border-ink"
          >
            Export CSV
          </a>
        }
      />
      <div className="flex flex-col gap-5 px-4 sm:px-8">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented<Preset>
            value={preset}
            onChange={pick}
            options={[
              { value: 'today', label: 'Today' },
              { value: 'yesterday', label: 'Yesterday' },
              { value: '7d', label: '7 days' },
              { value: '30d', label: '30 days' },
              { value: 'month', label: 'This month' },
              { value: 'custom', label: 'Custom' },
            ]}
          />
          {preset === 'custom' && (
            <div className="flex items-center gap-2">
              <Input id="from" type="date" className="h-10 w-40" value={from} max={to} onChange={(e) => setRange([e.target.value, to])} />
              <span className="text-mute">to</span>
              <Input id="to" type="date" className="h-10 w-40" value={to} min={from} max={todayIso()} onChange={(e) => setRange([from, e.target.value])} />
            </div>
          )}
          {loading && <span className="text-sm text-mute">Updating…</span>}
        </div>

        {!report ? (
          failed ? <LoadFailed message={failed} onRetry={() => load()} /> : <PageSpinner />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatTile label="Net sales (after refunds)" value={`${money(report.netSales)}`} note="ETB" />
              <StatTile label="Bills closed" value={report.orderCount.toLocaleString('en-US')} note={`avg ${money(report.averageOrderValue)} ETB`} />
              <StatTile label="VAT collected" value={money(report.tax)} note="ETB" />
              <StatTile label="Service charge" value={money(report.serviceCharge)} note="ETB" />
            </div>

            {!singleDay && report.series && (
              <Panel title="Sales per day">
                <ColumnChart
                  title="Closed bills, ETB"
                  unit="ETB"
                  data={report.series.map((d) => ({ label: dateLabel(`${d.date}T12:00:00Z`), value: Math.round(Number(d.sales)), detail: `${d.orders} bills` }))}
                />
              </Panel>
            )}

            <div className="grid gap-5 lg:grid-cols-2">
              <Panel title="Busiest hours">
                <ColumnChart
                  title="Bills closed per hour"
                  unit="bills"
                  height={180}
                  data={Array.from({ length: 18 }, (_, i) => i + 6).map((h) => {
                    const row = report.hourly.find((x) => x.hour === h);
                    return { label: hourLabel(h), value: row?.orders ?? 0, detail: `${money(row?.sales ?? 0)} ETB` };
                  })}
                />
              </Panel>
              <Panel title="Money in">
                <BarList title="By payment method, ETB" data={report.payments.map((p) => ({ label: p.name ?? METHOD_LABEL[p.method] ?? p.method, value: Number(p.total), detail: `${p.count} payments` }))} />
                <p className="mt-4 text-xs text-mute">
                  Total received {money(report.takings)} ETB · cash {money(report.cashSales)} · digital {money(report.digitalSales)}
                </p>
              </Panel>
            </div>

            <div className="grid gap-5 lg:grid-cols-3">
              <Panel title="Best sellers" className="lg:col-span-2">
                <BarList title="Items sold" data={report.topProducts.map((p) => ({ label: p.name, value: p.quantity, detail: `${money(p.revenue)} ETB` }))} />
              </Panel>
              <Panel title="Slowest">
                <ul className="flex flex-col gap-2 text-sm">
                  {report.slowProducts.map((p) => (
                    <li key={p.name} className="flex justify-between">
                      <span className="text-body">{p.name}</span>
                      <span className="font-semibold tnum">{p.quantity}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-mute">Items that sold nothing don’t appear. Worth a look before the next menu print.</p>
              </Panel>
            </div>

            <Panel title="Corrections">
              <dl className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
                <Fact label="Discounts" value={`${money(report.discounts)} ETB`} />
                <Fact label="Refunds" value={`${report.refundCount} · ${money(report.refunds)} ETB`} />
                <Fact label="Orders voided" value={`${report.voids.orders} · ${money(report.voids.ordersValue)} ETB`} />
                <Fact label="Items voided after firing" value={`${report.voids.items} · ${money(report.voids.itemsValue)} ETB`} />
              </dl>
            </Panel>

            <Panel title="Cash drawers">
              {variances.length === 0 ? (
                <p className="text-sm text-mute">No drawer shifts in this period.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-sm tnum">
                    <thead>
                      <tr className="text-left text-xs text-mute">
                        <th className="pb-2 font-semibold">Cashier</th>
                        <th className="pb-2 font-semibold">Opened</th>
                        <th className="pb-2 text-right font-semibold">Expected</th>
                        <th className="pb-2 text-right font-semibold">Counted</th>
                        <th className="pb-2 text-right font-semibold">Difference</th>
                        <th className="pb-2 pl-3 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {variances.map((v) => (
                        <tr key={v.shiftId} className="border-t border-line-soft">
                          <td className="py-2">{v.cashierName}</td>
                          <td className="py-2 text-mute">
                            {dateLabel(v.openedAt)} {clock(v.openedAt)}
                          </td>
                          <td className="py-2 text-right">{money(v.expectedCash)}</td>
                          <td className="py-2 text-right">{v.actualCash ? money(v.actualCash) : '—'}</td>
                          <td className={`py-2 text-right font-semibold ${Number(v.variance ?? 0) < 0 ? 'text-negative' : ''}`}>{v.variance ? money(v.variance, { sign: true }) : '—'}</td>
                          <td className="py-2 pl-3">
                            {v.status === 'OPEN' ? <Pill tone="info">Open</Pill> : v.status === 'CLOSING' ? <Pill tone="warn">Needs sign-off</Pill> : <Pill tone="good">Closed</Pill>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </>
        )}
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-mute">{label}</dt>
      <dd className="mt-0.5 font-semibold tnum">{value}</dd>
    </div>
  );
}
