'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { uuid } from '@/lib/uuid';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError, errorText } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { useLive } from '@/lib/live';
import { money, toCents } from '@/lib/format';
import { cacheMenu, cachedMenu, enqueue, flushQueue, toApiItems, type CartLine } from '@/lib/offline';
import type { Category, FloorTable, OrderDetail, OrderItem, Product } from '@/lib/types';
import { MenuBrowser } from '@/components/pos/MenuBrowser';
import { AddOnSheet } from '@/components/pos/AddOnSheet';
import { TransferSheet } from '@/components/pos/TransferSheet';
import { OrderPanel, cartTotal } from '@/components/pos/OrderPanel';
import { LiveDot } from '@/components/shell/AppShell';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Sheet } from '@/components/ui/Sheet';
import { Input } from '@/components/ui/Field';
import { PageSpinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { useRingOnIncrease } from '@/lib/sound';

interface Menu {
  products: Product[];
  categories: Category[];
}

function readCart(key: string): CartLine[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '[]') as CartLine[];
  } catch {
    return [];
  }
}

function OrderScreen() {
  const { orderId } = useParams<{ orderId: string }>();
  const search = useSearchParams();
  const isLocal = orderId === 'new'; // offline order, not on the server yet
  const router = useRouter();
  const { branchId, branch, can } = useSession();
  const { t } = useT();
  const toast = useToast();

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const cartKey = `cart:${isLocal ? `new:${search.get('tableId') ?? 'takeaway'}` : orderId}`;
  const [cart, setCart] = useState<CartLine[]>([]);
  const [picking, setPicking] = useState<{ product: Product; line?: CartLine } | null>(null);
  const [sending, setSending] = useState(false);
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [showOrder, setShowOrder] = useState(false);
  const [voiding, setVoiding] = useState<OrderItem | 'ORDER' | null>(null);
  const [reason, setReason] = useState('');
  const [moving, setMoving] = useState(false);
  const [freeTables, setFreeTables] = useState<FloorTable[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    setCart(readCart(cartKey));
    loaded.current = true;
  }, [cartKey]);
  useEffect(() => {
    if (!loaded.current) return;
    try {
      localStorage.setItem(cartKey, JSON.stringify(cart));
    } catch {
      /* ignore */
    }
  }, [cart, cartKey]);

  const loadOrder = useCallback(async () => {
    if (isLocal) return null;
    try {
      const o = await api.get<OrderDetail>(`/orders/${orderId}`);
      setOrder(o);
      return o;
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        toast('Order not found', 'error');
        router.replace('/pos/tables');
      } else if (!(e instanceof ApiError && e.code === 'NETWORK')) {
        toast(errorText(e), 'error');
      }
      return null;
    }
  }, [isLocal, orderId, router, toast]);

  const loadMenu = useCallback(async () => {
    if (!branchId) return;
    try {
      const [products, categories] = await Promise.all([
        api.get<Product[]>(`/products?branchId=${branchId}`),
        api.get<Category[]>(`/categories?branchId=${branchId}`),
      ]);
      const m = { products, categories };
      setMenu(m);
      cacheMenu(branchId, m);
    } catch {
      const cached = cachedMenu<Menu>(branchId);
      if (cached) setMenu(cached);
    }
  }, [branchId]);

  useEffect(() => {
    loadOrder();
  }, [loadOrder]);
  useEffect(() => {
    loadMenu();
  }, [loadMenu]);

  const live = useLive(branchId, ['order.updated', 'menu.updated'], (e) => {
    if (!e || e.type === 'menu.updated') loadMenu();
    if (!e || (e.type === 'order.updated' && e.entityId === orderId)) loadOrder();
  });

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const l of cart) c[l.productId] = (c[l.productId] ?? 0) + l.quantity;
    return c;
  }, [cart]);

  // ---- cart ----------------------------------------------------------------
  const addLine = (line: CartLine) => {
    setCart((xs) => {
      const existing = xs.findIndex((x) => x.key === line.key);
      if (existing >= 0) return xs.map((x, i) => (i === existing ? line : x));
      // Merge identical lines (same product, add-ons and note).
      const twin = xs.findIndex((x) => x.productId === line.productId && x.notes === line.notes && x.modifierIds.join() === line.modifierIds.join());
      if (twin >= 0) return xs.map((x, i) => (i === twin ? { ...x, quantity: Math.min(99, x.quantity + line.quantity) } : x));
      return [...xs, line];
    });
    setPicking(null);
  };

  const pick = (p: Product) => {
    if (p.modifiers.length > 0) return setPicking({ product: p });
    addLine({ key: uuid(), productId: p.id, name: p.name, unitPrice: p.sellingPrice, quantity: 1, modifierIds: [], modifierNames: [], modifierTotal: '0.00' });
    if (navigator.vibrate) navigator.vibrate(10);
  };

  const changeQty = (key: string, delta: number) =>
    setCart((xs) => xs.flatMap((x) => (x.key !== key ? [x] : x.quantity + delta <= 0 ? [] : [{ ...x, quantity: Math.min(99, x.quantity + delta) }])));

  // ---- send ----------------------------------------------------------------
  const send = async () => {
    if (cart.length === 0 || sending) return;
    setSending(true);
    const lines = cart;
    try {
      if (!navigator.onLine) throw new ApiError(0, 'NETWORK', 'offline', null);
      if (isLocal) {
        const created = await api.post<{ id: string; version: number }>('/orders', {
          branchId,
          tableId: search.get('tableId') ?? undefined,
          type: search.get('tableId') ? 'DINE_IN' : 'TAKEAWAY',
        });
        const added = await api.post<{ version: number }>(`/orders/${created.id}/items`, { expectedVersion: created.version, items: toApiItems(lines) });
        await api.post(`/orders/${created.id}/fire`, { expectedVersion: added.version });
        setCart([]);
        localStorage.removeItem(cartKey);
        toast(t('order.sent'));
        router.replace(`/pos/tables`);
        return;
      }
      let current = order ?? (await loadOrder());
      if (!current) return;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const added = await api.post<{ version: number }>(`/orders/${orderId}/items`, { expectedVersion: current.version, items: toApiItems(lines) });
          setCart([]);
          await api.post(`/orders/${orderId}/fire`, { expectedVersion: added.version });
          break;
        } catch (e) {
          if (e instanceof ApiError && e.code === 'ORDER_VERSION_CONFLICT' && attempt === 0) {
            current = await loadOrder();
            if (!current) throw e;
            continue;
          }
          throw e;
        }
      }
      toast(t('order.sent'));
      setShowOrder(false);
      await loadOrder();
      if (window.matchMedia('(max-width: 1023px)').matches) router.push('/pos/tables');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'NETWORK') {
        // Keep the order on this phone and deliver it when the Wi-Fi is back.
        if (isLocal) {
          enqueue({ kind: 'NEW_ORDER', branchId, tableId: search.get('tableId') ?? undefined, tableName: search.get('tableName') ?? 'Takeaway', lines });
        } else {
          enqueue({ kind: 'ADD_ITEMS', orderId, tableName: order?.tableName ?? undefined, lines });
        }
        setCart([]);
        localStorage.removeItem(cartKey);
        toast(t('order.queued'), 'info');
        flushQueue();
        router.push('/pos/tables');
      } else {
        toast(errorText(e), 'error');
        loadMenu();
      }
    } finally {
      setSending(false);
    }
  };

  // ---- actions on sent items ----------------------------------------------
  const serve = async (itemId?: string) => {
    setBusyItem(itemId ?? 'all');
    try {
      const o = await api.post<OrderDetail>(`/orders/${orderId}/serve`, itemId ? { itemIds: [itemId] } : {});
      setOrder(o);
      if (o.status === 'COMPLETED') {
        toast('Paid and served — table is free');
        router.push('/pos/tables');
      }
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusyItem(null);
    }
  };

  const startVoid = (item: OrderItem) => {
    if (item.status === 'PENDING') return doVoid(item, 'Removed before sending');
    setReason('');
    setVoiding(item);
  };

  const doVoid = async (target: OrderItem | 'ORDER', why: string) => {
    if (!order) return;
    try {
      if (target === 'ORDER') {
        await api.post(`/orders/${orderId}/void`, { expectedVersion: order.version, reason: why });
        toast('Order cancelled');
        localStorage.removeItem(cartKey);
        router.push('/pos/tables');
      } else {
        await api.post(`/orders/${orderId}/items/${target.id}/void`, { orderVersion: order.version, itemVersion: target.version, reason: why });
        toast(`${target.productNameSnapshot} removed`);
        await loadOrder();
      }
      setVoiding(null);
    } catch (e) {
      if (!(e instanceof ApiError && e.code === 'APPROVAL_CANCELLED')) toast(errorText(e), 'error');
      await loadOrder();
    }
  };

  const requestBill = async () => {
    try {
      await api.post(`/orders/${orderId}/request-bill`);
      toast(t('order.billRequested'));
      router.push('/pos/tables');
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };

  const openMove = async () => {
    setMoreOpen(false);
    try {
      const tables = await api.get<FloorTable[]>(`/tables?branchId=${branchId}`);
      setFreeTables(tables.filter((tb) => !tb.activeOrderId && tb.status !== 'OUT_OF_SERVICE'));
      setMoving(true);
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };

  const moveTo = async (tableId: string) => {
    if (!order) return;
    try {
      await api.post(`/orders/${orderId}/transfer`, { expectedVersion: order.version, toTableId: tableId });
      setMoving(false);
      toast('Moved');
      loadOrder();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };

  useRingOnIncrease(order ? order.items.filter((i) => i.status === 'READY').length : null);

  // ---- render -------------------------------------------------------------
  if (!menu || (!isLocal && !order)) return <PageSpinner />;

  const title = isLocal ? (search.get('tableName') ?? t('common.takeaway')) : (order?.tableName ?? t('common.takeaway'));
  const readyCount = order?.items.filter((i) => i.status === 'READY').length ?? 0;
  const closed = !isLocal && order && !order.canEdit;
  const cartCount = cart.reduce((n, l) => n + l.quantity, 0);

  const panel = (
    <OrderPanel
      order={order}
      cart={cart}
      onEditLine={(l) => {
        const p = menu.products.find((x) => x.id === l.productId);
        if (p) setPicking({ product: p, line: l });
      }}
      onChangeQty={changeQty}
      onServe={(id) => serve(id)}
      onVoid={startVoid}
      busyItem={busyItem}
    />
  );

  const unsentOnServer = order?.items.filter((i) => i.status === 'PENDING') ?? [];
  const sendUnsent = async () => {
    if (!order) return;
    setSending(true);
    try {
      await api.post(`/orders/${orderId}/fire`, { expectedVersion: order.version });
      toast(t('order.sent'));
      await loadOrder();
    } catch (e) {
      toast(errorText(e), 'error');
      loadOrder();
    } finally {
      setSending(false);
    }
  };

  const actions = (
    <div className="flex flex-col gap-2">
      {unsentOnServer.length > 0 && cart.length === 0 && (
        <Button size="xl" block onClick={sendUnsent} loading={sending}>
          {t('order.sendKitchen')} · {unsentOnServer.reduce((n, i) => n + i.quantity, 0)} {t('order.status.PENDING').toLowerCase()}
        </Button>
      )}
      {cart.length > 0 ? (
        <Button size="xl" block onClick={send} loading={sending}>
          {t('order.sendKitchen')} · {cartCount}
        </Button>
      ) : !isLocal && order?.canEdit ? (
        <div className="grid grid-cols-2 gap-2">
          <Button size="lg" variant={readyCount ? 'primary' : 'secondary'} disabled={!readyCount} onClick={() => serve()} loading={busyItem === 'all'}>
            {t('order.serveAll')}
            {readyCount ? ` · ${readyCount}` : ''}
          </Button>
          <Button size="lg" variant="dark" onClick={requestBill} disabled={!order.items.some((i) => i.status !== 'CANCELLED')}>
            {t('order.requestBill')}
          </Button>
        </div>
      ) : null}
      {/* Transfers recorded at this table, waiting for the cashier. */}
      {!isLocal &&
        order?.payments
          .filter((p) => p.status === 'PENDING_VERIFICATION' || (p.status === 'REJECTED' && p.receivedById === order.waiterId))
          .map((p) => (
            <p key={p.id} className={`rounded-md px-3 py-2 text-sm ${p.status === 'REJECTED' ? 'bg-negative-bg text-negative' : 'bg-info-bg text-info'}`}>
              {p.methodName ?? p.method} {money(p.appliedAmount)} ·{' '}
              {p.status === 'REJECTED' ? 'the cashier did not find this money — talk to the customer' : 'waiting for the cashier to check'}
            </p>
          ))}
      {cart.length === 0 &&
        !isLocal &&
        order?.canEdit &&
        can('payment.report') &&
        branch?.waiterPayments !== false &&
        toCents(order.balanceDue) - order.payments.filter((p) => p.status === 'PENDING_VERIFICATION').reduce((a, p) => a + toCents(p.appliedAmount), 0) > 0 && (
          <Button size="lg" variant="outline" block onClick={() => setTransferOpen(true)}>
            <Icon name="camera" size={18} /> Customer paid by transfer
          </Button>
        )}
    </div>
  );

  return (
    <div className="flex h-[100dvh] flex-col bg-canvas-soft">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-canvas px-2" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <button onClick={() => router.push('/pos/tables')} aria-label={t('common.back')} className="grid h-11 w-11 place-items-center rounded-full hover:bg-canvas-sunk">
          <Icon name="back" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-display-sm leading-tight">{title}</p>
          <p className="text-xs text-mute">
            {isLocal ? t('common.offline') : `#${order?.orderNumber}`} {order?.waiterName ? `· ${order.waiterName}` : ''}
          </p>
        </div>
        <LiveDot status={live} />
        {!isLocal && order?.canEdit && (
          <div className="relative">
            <button onClick={() => setMoreOpen((v) => !v)} aria-label="More actions" className="grid h-11 w-11 place-items-center rounded-full hover:bg-canvas-sunk">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="5" r="2" />
                <circle cx="12" cy="12" r="2" />
                <circle cx="12" cy="19" r="2" />
              </svg>
            </button>
            {moreOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setMoreOpen(false)} />
                <div className="absolute right-0 top-12 z-40 w-56 overflow-hidden rounded-lg border border-line bg-canvas shadow-pop">
                  <button onClick={openMove} className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm hover:bg-canvas-soft">
                    <Icon name="move" size={18} /> {t('order.moveTable')}
                  </button>
                  {can('order.view') && (
                    <button
                      onClick={async () => {
                        setMoreOpen(false);
                        try {
                          await api.post(`/orders/${orderId}/print-bill`);
                          toast('Bill sent to printer');
                        } catch (e) {
                          toast(errorText(e), 'error');
                        }
                      }}
                      className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm hover:bg-canvas-soft"
                    >
                      <Icon name="receipt" size={18} /> Print bill
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setMoreOpen(false);
                      setReason('');
                      setVoiding('ORDER');
                    }}
                    className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-negative hover:bg-negative-bg"
                  >
                    <Icon name="x" size={18} /> {t('order.voidOrder')}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </header>

      {closed && <p className="bg-canvas-sunk px-4 py-2 text-center text-sm font-semibold text-body">{t('order.closed')}</p>}

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">{closed ? <div className="h-full overflow-y-auto bg-canvas">{panel}</div> : <MenuBrowser categories={menu.categories} products={menu.products} counts={counts} onPick={pick} />}</div>

        {/* Tablet / desktop: order always visible on the right. */}
        {!closed && (
          <aside className="hidden w-[380px] shrink-0 flex-col border-l border-line bg-canvas lg:flex">
            <div className="flex-1 overflow-y-auto">
              {cart.length === 0 && (order?.items.length ?? 0) === 0 ? <p className="px-6 py-16 text-center text-sm text-mute">{t('order.noItems')}</p> : panel}
            </div>
            <div className="safe-bottom border-t border-line p-3">{actions}</div>
          </aside>
        )}
      </div>

      {/* Phone: one bar at the bottom; tap it to review the order. */}
      {!closed && (
        <div className="safe-bottom border-t border-line bg-canvas px-3 pt-2 lg:hidden">
          <div className="flex items-center gap-2">
            <button onClick={() => setShowOrder(true)} className="flex h-14 min-w-0 flex-1 flex-col justify-center rounded-lg bg-ink px-4 text-left text-white">
              <span className="text-xs text-[#b9bdb4]">
                {cartCount > 0 ? `${cartCount} new · ${t('order.review')}` : `${order?.items.filter((i) => i.status !== 'CANCELLED').length ?? 0} on table · ${t('order.review')}`}
                {readyCount > 0 && <span className="ml-1 font-bold text-primary">· {t('table.ready', { n: readyCount })}</span>}
              </span>
              <span className="font-display text-lg font-extrabold tnum">{cartCount > 0 ? `+${money(cartTotal(cart))}` : money(order?.totalAmount ?? 0)}</span>
            </button>
            {cart.length > 0 ? (
              <Button size="xl" onClick={send} loading={sending} className="h-14 shrink-0">
                {t('order.sendKitchen')}
              </Button>
            ) : unsentOnServer.length > 0 ? (
              <Button size="xl" onClick={sendUnsent} loading={sending} className="h-14 shrink-0">
                {t('order.sendKitchen')}
              </Button>
            ) : readyCount > 0 ? (
              <Button size="xl" onClick={() => serve()} loading={busyItem === 'all'} className="h-14 shrink-0">
                {t('order.serveAll')}
              </Button>
            ) : null}
          </div>
        </div>
      )}

      <Sheet open={showOrder} onClose={() => setShowOrder(false)} title={title} footer={<div className="pb-1">{actions}</div>}>
        <div className="-mx-5 -my-4">{panel}</div>
      </Sheet>

      {picking && <AddOnSheet product={picking.product} initial={picking.line} onClose={() => setPicking(null)} onDone={addLine} />}

      <Sheet
        open={!!voiding}
        onClose={() => setVoiding(null)}
        title={voiding === 'ORDER' ? t('order.voidOrder') : voiding ? `${t('order.remove')} ${voiding.productNameSnapshot}` : ''}
        footer={
          <Button variant="danger" size="xl" block disabled={reason.trim().length < 3} onClick={() => voiding && doVoid(voiding, reason.trim())} className="mb-1">
            {voiding === 'ORDER' ? t('order.voidOrder') : t('order.remove')}
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-body">The kitchen already has this. A cancellation ticket will print, and a manager must approve with their PIN.</p>
          <div className="flex flex-wrap gap-2">
            {['Customer changed mind', 'Wrong item entered', 'Took too long', 'Out of ingredient'].map((r) => (
              <button key={r} onClick={() => setReason(r)} className={`rounded-full px-3 py-2 text-sm font-semibold ${reason === r ? 'bg-ink text-white' : 'bg-canvas-sunk hover:bg-line'}`}>
                {r}
              </button>
            ))}
          </div>
          <Input id="void-reason" placeholder={t('order.reason')} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
        </div>
      </Sheet>

      {order && !isLocal && <TransferSheet open={transferOpen} onClose={() => setTransferOpen(false)} order={order} onDone={() => loadOrder()} />}

      <Sheet open={moving} onClose={() => setMoving(false)} title={t('order.pickTable')}>
        <div className="grid grid-cols-3 gap-2 pb-2">
          {freeTables.map((tb) => (
            <button key={tb.id} onClick={() => moveTo(tb.id)} className="h-20 rounded-lg border-2 border-line bg-state-free font-display text-2xl font-black hover:border-ink">
              {tb.name}
            </button>
          ))}
          {freeTables.length === 0 && <p className="col-span-3 py-6 text-center text-sm text-mute">No free tables right now.</p>}
        </div>
      </Sheet>
    </div>
  );
}

export default function OrderPage() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <OrderScreen />
    </Suspense>
  );
}
