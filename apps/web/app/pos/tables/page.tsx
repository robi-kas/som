'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, errorText } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { useLive, useNow } from '@/lib/live';
import { elapsed, money } from '@/lib/format';
import type { FloorTable, OrderListRow } from '@/lib/types';
import { AppShell } from '@/components/shell/AppShell';
import { Segmented } from '@/components/ui/Segmented';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { PageSpinner } from '@/components/ui/Spinner';
import { Empty } from '@/components/ui/Empty';
import { useToast } from '@/components/ui/Toast';
import { OfflineQueueBadge } from '@/components/pos/OfflineQueueBadge';
import { useRingOnIncrease } from '@/lib/sound';

type Filter = 'all' | 'mine';

export default function FloorPage() {
  const { me, branchId } = useSession();
  const { t } = useT();
  const toast = useToast();
  const router = useRouter();
  const now = useNow(20_000);
  const [tables, setTables] = useState<FloorTable[] | null>(null);
  const [takeaways, setTakeaways] = useState<OrderListRow[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [opening, setOpening] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!branchId) return;
    try {
      const [tbl, orders] = await Promise.all([
        api.get<FloorTable[]>(`/tables?branchId=${branchId}`),
        api.get<OrderListRow[]>(`/orders?branchId=${branchId}&status=DRAFT,SUBMITTED,CONFIRMED,PREPARING,READY,SERVED&limit=100`),
      ]);
      setTables(tbl);
      setTakeaways(orders.filter((o) => !o.tableId));
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }, [branchId, toast]);

  useEffect(() => {
    load();
  }, [load]);
  const live = useLive(branchId, ['table.updated', 'order.updated', 'ticket.updated', 'payment.updated'], () => load(), 20_000);

  const visible = useMemo(
    () => (tables ?? []).filter((tb) => filter === 'all' || tb.order?.waiterId === me?.user.id),
    [tables, filter, me],
  );
  // Ring 3 times whenever more food becomes ready for this waiter's tables.
  const readyItems =
    tables === null
      ? null
      : (tables ?? []).reduce((n, tb) => n + (tb.order && (filter === 'all' || tb.order.waiterId === me?.user.id) ? tb.order.readyCount : 0), 0) +
        takeaways.reduce((n, o) => n + o.readyCount, 0);
  useRingOnIncrease(readyItems);

  const readyTables = (tables ?? []).filter((tb) => tb.order && tb.order.readyCount > 0 && (filter === 'all' || tb.order.waiterId === me?.user.id));

  const openTable = async (tb: FloorTable) => {
    if (tb.status === 'OUT_OF_SERVICE') return;
    if (tb.activeOrderId) return router.push(`/pos/orders/${tb.activeOrderId}`);
    if (!navigator.onLine) {
      // Offline: build the order on this phone; it is sent when the Wi-Fi is back.
      return router.push(`/pos/orders/new?tableId=${tb.id}&tableName=${encodeURIComponent(tb.name)}`);
    }
    setOpening(tb.id);
    try {
      const order = await api.post<{ id: string }>('/orders', { branchId, tableId: tb.id });
      router.push(`/pos/orders/${order.id}`);
    } catch (e) {
      toast(errorText(e), 'error');
      load();
    } finally {
      setOpening(null);
    }
  };

  const newTakeaway = async () => {
    if (!navigator.onLine) return router.push('/pos/orders/new');
    setOpening('takeaway');
    try {
      const order = await api.post<{ id: string }>('/orders', { branchId, type: 'TAKEAWAY' });
      router.push(`/pos/orders/${order.id}`);
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setOpening(null);
    }
  };

  return (
    <AppShell live={live} title={t('nav.floor')}>
      <div className="flex h-full flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-canvas px-3 py-2.5 sm:px-5">
          <Segmented<Filter>
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: t('table.all') },
              { value: 'mine', label: t('table.mine') },
            ]}
          />
          <OfflineQueueBadge />
          <Button variant="dark" className="ml-auto" onClick={newTakeaway} loading={opening === 'takeaway'}>
            <Icon name="plus" size={18} />
            {t('table.newTakeaway')}
          </Button>
        </div>

        {readyTables.length > 0 && (
          <button
            onClick={() => router.push(`/pos/orders/${readyTables[0].activeOrderId}`)}
            className="flex items-center gap-3 bg-primary px-4 py-3 text-left font-semibold text-ink sm:px-5"
          >
            <Icon name="bell" className="animate-pulse2" />
            {t('table.readyBanner', { tables: readyTables.map((r) => r.name).join(', ') })}
          </button>
        )}

        <div className="flex-1 overflow-y-auto p-3 sm:p-5">
          {!tables ? (
            <PageSpinner />
          ) : visible.length === 0 && takeaways.length === 0 ? (
            <Empty title={filter === 'mine' ? 'No tables yet' : 'No tables set up'}>
              {filter === 'mine' ? 'Tables you open will show here.' : 'Add tables in Manage → Tables.'}
            </Empty>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {visible.map((tb) => (
                  <TableCard key={tb.id} table={tb} now={now} busy={opening === tb.id} onOpen={() => openTable(tb)} />
                ))}
              </div>

              {takeaways.length > 0 && (
                <section className="mt-6">
                  <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-mute">{t('common.takeaway')}</h2>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                    {takeaways.map((o) => (
                      <button
                        key={o.id}
                        onClick={() => router.push(`/pos/orders/${o.id}`)}
                        className="flex flex-col gap-1 rounded-lg border border-line bg-canvas p-3 text-left hover:border-ink"
                      >
                        <span className="font-display text-lg font-extrabold">#{o.orderNumber.split('-').pop()}</span>
                        <span className="text-sm text-body">
                          {o.itemCount === 1 ? t('common.item') : t('common.items', { n: o.itemCount })} · {money(o.totalAmount)}
                        </span>
                        {o.readyCount > 0 && <span className="text-sm font-bold text-positive">{t('table.ready', { n: o.readyCount })}</span>}
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function TableCard({ table, now, busy, onOpen }: { table: FloorTable; now: number; busy: boolean; onOpen: () => void }) {
  const { t } = useT();
  const o = table.order;

  let tone = 'bg-state-free border-line';
  let label = t('table.free');
  let labelTone = 'text-mute';
  if (table.status === 'OUT_OF_SERVICE') {
    tone = 'bg-state-off border-line opacity-60';
    label = t('table.off');
  } else if (o && o.readyCount > 0) {
    tone = 'bg-state-ready border-positive';
    label = t('table.ready', { n: o.readyCount });
    labelTone = 'text-positive';
  } else if (table.status === 'WAITING_FOR_PAYMENT') {
    tone = 'bg-state-bill border-[#e8a15a]';
    label = t('table.bill');
    labelTone = 'text-[#8a4b0f]';
  } else if (o) {
    tone = 'bg-state-seated border-[#f0d77a]';
    label = o.pendingCount > 0 ? t('table.notSent') : o.inKitchenCount > 0 ? t('table.inKitchen') : t('table.seated');
    labelTone = o.pendingCount > 0 ? 'text-negative' : 'text-warning-deep';
  }

  return (
    <button
      onClick={onOpen}
      disabled={busy || table.status === 'OUT_OF_SERVICE'}
      className={`relative flex min-h-[124px] flex-col rounded-lg border-2 p-3 text-left transition-transform active:scale-[0.98] disabled:cursor-default ${tone}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-display text-[28px] font-black leading-none tracking-tight">{table.name}</span>
        {o && <span className="font-mono text-xs text-body tnum">{elapsed(o.openedAt, now)}</span>}
      </div>
      <span className={`mt-1 text-sm font-bold ${labelTone}`}>{label}</span>
      <div className="mt-auto flex items-end justify-between gap-2 pt-2 text-xs text-body">
        {o ? (
          <>
            <span className="truncate">{o.waiterName}</span>
            <span className="font-semibold tnum">{money(o.totalAmount)}</span>
          </>
        ) : (
          <span>{t('table.guests', { n: table.capacity })}</span>
        )}
      </div>
      {o && o.readyCount > 0 && <span className="absolute -right-1.5 -top-1.5 h-4 w-4 animate-pulse2 rounded-full bg-primary ring-2 ring-canvas" />}
      {busy && <span className="absolute inset-0 grid place-items-center rounded-lg bg-canvas/60 text-sm font-semibold">…</span>}
    </button>
  );
}
