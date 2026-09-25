'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, errorText } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useLive } from '@/lib/live';
import { money, todayIso, METHOD_LABEL } from '@/lib/format';
import type { Dashboard, PeriodReport } from '@/lib/reports';
import { hourLabel } from '@/lib/reports';
import { PageHeader, Panel } from '@/components/admin/AdminShell';
import { BarList, ColumnChart, StatTile } from '@/components/admin/Charts';
import { PageSpinner, LoadFailed } from '@/components/ui/Spinner';
import { Icon, type IconName } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';

export default function TodayPage() {
  const { branchId, branch, can } = useSession();
  const toast = useToast();
  const [failed, setFailed] = useState<string | null>(null);
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [day, setDay] = useState<PeriodReport | null>(null);

  const load = useCallback(async () => {
    if (!branchId) return;
    try {
      setFailed(null);
      const [d, r] = await Promise.all([
        api.get<Dashboard>(`/reports/dashboard?branchId=${branchId}`),
        can('report.view_financial') ? api.get<PeriodReport>(`/reports/daily-sales?branchId=${branchId}&date=${todayIso()}`) : Promise.resolve(null),
      ]);
      setDash(d);
      setDay(r);
    } catch (e) {
      setFailed(errorText(e));
      toast(errorText(e), 'error');
    }
  }, [branchId, can, toast]);

  useEffect(() => {
    load();
  }, [load]);
  useLive(branchId, ['order.updated', 'payment.updated', 'ticket.updated', 'printer.updated', 'table.updated'], () => load(), 30_000);

  if (!dash) return failed ? <LoadFailed message={failed} onRetry={() => load()} /> : <PageSpinner />;
  const a = dash.needsAttention;
  const alerts: { n: number; label: string; href: string; icon: IconName }[] = [
    { n: a.paymentVerifications, label: 'digital payments to verify', href: '/admin/approvals', icon: 'check' },
    { n: a.refundApprovals, label: 'refunds to approve', href: '/admin/approvals?tab=refunds', icon: 'receipt' },
    { n: a.drawerVariances, label: 'drawers that didn’t balance', href: '/admin/approvals?tab=drawers', icon: 'cash' },
    { n: a.lateTickets, label: 'kitchen tickets running late', href: '/kds', icon: 'kitchen' },
    { n: a.printerProblems, label: 'printer problems', href: '/admin/printers', icon: 'printer' },
  ].filter((x) => x.n > 0);

  return (
    <div className="pb-10">
      <PageHeader title="Today" sub={`${branch?.name ?? ''} · updates live`} />
      <div className="flex flex-col gap-5 px-4 sm:px-8">
        <div className="grid gap-4 lg:grid-cols-[1.3fr_2fr]">
          <div className="flex flex-col justify-between gap-4 rounded-xl bg-ink p-6 text-white">
            <p className="text-sm text-[#b9bdb4]">Sales today (closed bills)</p>
            <p className="font-sans text-[52px] font-semibold leading-none tnum">
              {money(dash.todaySales)} <span className="text-lg font-normal text-[#b9bdb4]">ETB</span>
            </p>
            <p className="text-sm text-[#b9bdb4]">
              {dash.ordersClosedToday} bills · average {money(dash.averageOrderValue)}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatTile label="Tables in use" value={`${dash.occupiedTablesCount + dash.tablesWaitingForPaymentCount} / ${dash.tablesTotal}`} />
            <StatTile label="Asking for the bill" value={String(dash.tablesWaitingForPaymentCount)} tone={dash.tablesWaitingForPaymentCount > 0 ? 'attention' : undefined} />
            <StatTile label="Open orders" value={String(dash.openOrdersCount)} />
            <StatTile label="Tickets over time" value={String(dash.ordersWaitingTooLongCount)} tone={dash.ordersWaitingTooLongCount > 0 ? 'attention' : undefined} />
            <StatTile label="Drawers open" value={String(dash.activeEmployeesCount)} />
            <StatTile label="Printers offline" value={String(dash.printersOffline)} tone={dash.printersOffline > 0 ? 'attention' : undefined} />
          </div>
        </div>

        {alerts.length > 0 && (
          <div className="flex flex-col gap-2 rounded-xl border border-[#f0d77a] bg-warning-bg p-4">
            <p className="text-sm font-bold text-warning-deep">Needs you now</p>
            <div className="flex flex-wrap gap-2">
              {alerts.map((x) => (
                <Link key={x.label} href={x.href} className="inline-flex h-10 items-center gap-2 rounded-full bg-canvas px-4 text-sm font-semibold hover:ring-2 hover:ring-ink">
                  <Icon name={x.icon} size={16} />
                  <span className="tnum">{x.n}</span> {x.label}
                </Link>
              ))}
            </div>
          </div>
        )}

        {day && (
          <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
            <Panel title="Sales by hour">
              <ColumnChart
                title="Closed bills, ETB"
                unit="ETB"
                data={Array.from({ length: 18 }, (_, i) => i + 6).map((h) => {
                  const row = day.hourly.find((x) => x.hour === h);
                  return { label: hourLabel(h), value: Math.round(Number(row?.sales ?? 0)), detail: `${row?.orders ?? 0} bills` };
                })}
              />
            </Panel>
            <Panel title="Money in today">
              <BarList
                title="By payment method, ETB"
                data={dash.takingsByMethod.map((m) => ({ label: m.name ?? METHOD_LABEL[m.method] ?? m.method, value: Number(m.total) }))}
                empty="No payments yet today"
              />
            </Panel>
          </div>
        )}

        {day && (
          <div className="grid gap-5 md:grid-cols-2">
            <Panel title="Best sellers today">
              <BarList title="Items sold" data={day.topProducts.map((p) => ({ label: p.name, value: p.quantity, detail: `${money(p.revenue)} ETB` }))} empty="Nothing sold yet" />
            </Panel>
            <Panel title="Corrections today">
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <Fact label="Discounts given" value={`${money(day.discounts)} ETB`} />
                <Fact label="Refunds" value={`${day.refundCount} · ${money(day.refunds)} ETB`} />
                <Fact label="Orders voided" value={`${day.voids.orders} · ${money(day.voids.ordersValue)} ETB`} />
                <Fact label="Items removed after firing" value={`${day.voids.items} · ${money(day.voids.itemsValue)} ETB`} />
              </dl>
              <Link href="/admin/activity" className="mt-4 inline-block text-sm font-semibold text-primary-deep hover:underline">
                See who did what →
              </Link>
            </Panel>
          </div>
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
