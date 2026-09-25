'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError, errorText } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { useLive, useNow } from '@/lib/live';
import { money } from '@/lib/format';
import type { OrderDetail, OrderListRow, PaymentMethodConfig, Shift } from '@/lib/types';
import { AppShell } from '@/components/shell/AppShell';
import { BillList, sortBills } from '@/components/cashier/BillList';
import { PaymentPanel } from '@/components/cashier/PaymentPanel';
import { ShiftGate } from '@/components/cashier/ShiftGate';
import { DrawerSheet } from '@/components/cashier/DrawerSheet';
import { RefundPanel } from '@/components/cashier/RefundPanel';
import { MissingReferencesSheet, type MissingRef } from '@/components/cashier/MissingReferences';
import { Segmented } from '@/components/ui/Segmented';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { PageSpinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { useRingOnIncrease } from '@/lib/sound';

export default function CashierPage() {
  const { branchId } = useSession();
  const { t } = useT();
  const toast = useToast();
  const now = useNow(30_000);
  const [shift, setShift] = useState<Shift | null | undefined>(undefined);
  const [bills, setBills] = useState<OrderListRow[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [methods, setMethods] = useState<PaymentMethodConfig[]>([]);
  const [tab, setTab] = useState<'open' | 'closed'>('open');
  const [closed, setClosed] = useState<OrderListRow[]>([]);
  const [missing, setMissing] = useState<MissingRef[]>([]);
  const [missingOpen, setMissingOpen] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!branchId) return;
    api.get<PaymentMethodConfig[]>(`/payment-methods?branchId=${branchId}`).then(setMethods).catch((e) => toast(errorText(e), 'error'));
  }, [branchId, toast]);

  const loadShift = useCallback(async () => {
    try {
      setShift(await api.get<Shift>('/shifts/current'));
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setShift(null);
      else toast(errorText(e), 'error');
    }
  }, [toast]);

  const loadBills = useCallback(async () => {
    if (!branchId) return;
    try {
      const rows = await api.get<OrderListRow[]>(`/orders?branchId=${branchId}&status=DRAFT,SUBMITTED,CONFIRMED,PREPARING,READY,SERVED&limit=200`);
      setBills(sortBills(rows.filter((r) => r.itemCount > 0)));
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }, [branchId, toast]);

  // Bills paid and closed since midnight: where refunds start.
  const loadClosed = useCallback(async () => {
    if (!branchId) return;
    try {
      const rows = await api.get<OrderListRow[]>(`/orders?branchId=${branchId}&status=COMPLETED&limit=200`);
      const midnight = new Date();
      midnight.setHours(0, 0, 0, 0);
      setClosed(rows.filter((r) => new Date(r.updatedAt) >= midnight));
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }, [branchId, toast]);

  const loadMissing = useCallback(async () => {
    if (!branchId) return;
    try {
      setMissing(await api.get<MissingRef[]>(`/payments/missing-reference?branchId=${branchId}`));
    } catch {
      /* the list is a helper; the drawer close still enforces it */
    }
  }, [branchId]);

  const loadOrder = useCallback(async (id: string | null) => {
    if (!id) return setOrder(null);
    try {
      setOrder(await api.get<OrderDetail>(`/orders/${id}`));
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }, [toast]);

  useEffect(() => {
    loadShift();
  }, [loadShift]);
  useEffect(() => {
    loadBills();
    loadMissing();
  }, [loadBills, loadMissing]);
  useEffect(() => {
    if (tab === 'closed') loadClosed();
  }, [tab, loadClosed]);
  useEffect(() => {
    loadOrder(selected);
  }, [selected, loadOrder]);

  const live = useLive(branchId, ['order.updated', 'payment.updated', 'table.updated'], (e) => {
    loadBills();
    loadMissing();
    if (tab === 'closed') loadClosed();
    if (selected && (!e || e.entityId === selected)) loadOrder(selected);
  });

  // Ring when a table asks for the bill or a digital payment is waiting to be checked.
  useRingOnIncrease(bills ? bills.filter((b) => b.tableStatus === 'WAITING_FOR_PAYMENT' || b.hasPendingVerification).length : null);

  const matches = (rows: OrderListRow[]) => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.tableName.toLowerCase().includes(q) || r.orderNumber.toLowerCase().includes(q) || r.waiterName?.toLowerCase().includes(q));
  };

  const selectedRow = useMemo(() => bills?.find((b) => b.id === selected), [bills, selected]);

  if (shift === undefined || !bills) {
    return (
      <AppShell live={live} title={t('nav.cashier')}>
        <PageSpinner />
      </AppShell>
    );
  }

  return (
    <AppShell live={live} title={t('nav.cashier')}>
      {shift === null ? (
        <ShiftGate branchId={branchId} onOpened={(s) => setShift(s)} />
      ) : (
        <div className="flex h-full">
          <aside className={`w-full shrink-0 flex-col border-r border-line bg-canvas-soft md:flex md:w-[300px] lg:w-[320px] ${selected ? 'hidden' : 'flex'}`}>
            <div className="flex flex-col gap-2 border-b border-line px-3 py-2.5">
              <Segmented
                value={tab}
                onChange={(v) => {
                  setTab(v);
                  setSelected(null);
                }}
                options={[
                  { value: 'open', label: `${t('cashier.openBills')} · ${bills.length}` },
                  { value: 'closed', label: 'Closed today' },
                ]}
              />
              <div className="flex items-center gap-2">
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Find table or bill…"
                  aria-label="Find a bill"
                  className="h-9 min-w-0 flex-1 rounded-md border border-line bg-canvas px-2.5 text-sm outline-none focus:border-ink"
                />
                <Button variant="outline" size="sm" onClick={() => setDrawer(true)}>
                  <Icon name="cash" size={16} /> Drawer
                </Button>
              </div>
            </div>
            {missing.length > 0 && (
              <button
                onClick={() => setMissingOpen(true)}
                className="flex items-center justify-between gap-2 border-b border-line bg-warning-bg px-3 py-2.5 text-left text-sm font-semibold text-warning-deep hover:brightness-95"
              >
                <span>
                  {missing.length} payment{missing.length === 1 ? '' : 's'} need{missing.length === 1 ? 's' : ''} a transaction number
                </span>
                <span className="underline">Fill in</span>
              </button>
            )}
            <div className="flex-1 overflow-y-auto">
              {tab === 'open' ? (
                <BillList bills={matches(bills)} selected={selected} onSelect={setSelected} now={now} />
              ) : closed.length === 0 ? (
                <p className="p-6 text-center text-sm text-mute">No bills closed yet today.</p>
              ) : (
                <ul>
                  {matches(closed).map((b) => (
                    <li key={b.id}>
                      <button
                        onClick={() => setSelected(b.id)}
                        className={`flex w-full items-center justify-between gap-2 border-b border-line px-3 py-3 text-left text-sm ${selected === b.id ? 'bg-primary-pale' : 'hover:bg-canvas-sunk'}`}
                      >
                        <span className="min-w-0">
                          <span className="block font-semibold">{b.tableName}</span>
                          <span className="block truncate text-xs text-mute">
                            {b.orderNumber} · {new Date(b.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            {b.paymentStatus !== 'PAID' ? ` · ${b.paymentStatus.replace(/_/g, ' ').toLowerCase()}` : ''}
                          </span>
                        </span>
                        <span className="font-semibold tnum">{money(b.totalAmount)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>

          <section className={`min-w-0 flex-1 flex-col bg-canvas ${selected ? 'flex' : 'hidden md:flex'}`}>
            {selected && (
              <button onClick={() => setSelected(null)} className="flex h-11 items-center gap-1 border-b border-line px-3 text-sm font-semibold md:hidden">
                <Icon name="back" size={18} /> {t('cashier.openBills')}
              </button>
            )}
            {order && selected && tab === 'closed' ? (
              <RefundPanel
                order={order}
                onChanged={() => {
                  loadOrder(selected);
                  loadClosed();
                }}
              />
            ) : order && selected ? (
              order.canEdit ? (
                <PaymentPanel
                  order={order}
                  methods={methods}
                  onChanged={() => {
                    loadOrder(selected);
                    loadBills();
                  }}
                  onDone={() => setSelected(null)}
                />
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
                  <p className="font-display text-display-md">Closed</p>
                  <p className="text-sm text-mute">
                    {selectedRow?.tableName ?? order.tableName} · {money(order.totalAmount)} paid in full.
                  </p>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setTab('closed')}>
                      Refund…
                    </Button>
                    <Button onClick={() => setSelected(null)}>Next bill</Button>
                  </div>
                </div>
              )
            ) : selected ? (
              <PageSpinner />
            ) : (
              <div className="flex flex-1 items-center justify-center p-8 text-sm text-mute">{t('cashier.selectBill')}</div>
            )}
          </section>
        </div>
      )}
      <MissingReferencesSheet
        open={missingOpen}
        onClose={() => setMissingOpen(false)}
        rows={missing}
        onSaved={() => {
          loadMissing();
          if (selected) loadOrder(selected);
        }}
      />
      {shift && (
        <DrawerSheet
          shift={shift}
          open={drawer}
          onClose={() => setDrawer(false)}
          onClosed={() => {
            setDrawer(false);
            loadShift();
          }}
        />
      )}
    </AppShell>
  );
}
