'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorText } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { useLive, useNow } from '@/lib/live';
import { minutesSince } from '@/lib/format';
import type { KdsTicket, Product } from '@/lib/types';
import { Sheet } from '@/components/ui/Sheet';
import { AppShell } from '@/components/shell/AppShell';
import { Segmented } from '@/components/ui/Segmented';
import { PageSpinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { ring } from '@/lib/sound';

interface Station {
  id: string;
  name: string;
}

export default function KitchenPage() {
  const { branchId, branch, me, can } = useSession();
  const { t } = useT();
  const toast = useToast();
  const now = useNow(10_000);
  const [stations, setStations] = useState<Station[]>([]);
  const [station, setStation] = useState<string>('');
  const [tickets, setTickets] = useState<KdsTicket[] | null>(null);
  const [recent, setRecent] = useState<{ id: string; orderNumber: string; tableName: string }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const seen = useRef<Set<string> | null>(null);

  const warn = branch?.ticketWarnMinutes ?? 8;
  const late = branch?.ticketLateMinutes ?? 12;

  // Station staff (barista, juice, chef) are locked to their own station(s); managers can pick any.
  const mine = (me?.stations ?? []).filter((s) => s.branchId === branchId);
  const locked = mine.length > 0 && !can('report.view');
  const [stockOpen, setStockOpen] = useState(false);
  const [stock, setStock] = useState<Product[] | null>(null);
  const [stockQuery, setStockQuery] = useState('');

  useEffect(() => {
    if (locked) {
      setStation((cur) => (mine.some((m) => m.id === cur) ? cur : mine[0].id));
      return;
    }
    try {
      setStation(localStorage.getItem('kdsStation') ?? (mine[0]?.id ?? ''));
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, mine.map((m) => m.id).join()]);

  const openStock = async () => {
    setStockOpen(true);
    setStock(null);
    setStockQuery('');
    try {
      const all = await api.get<Product[]>(`/products?branchId=${branchId}`);
      const ids = station ? [station] : locked ? mine.map((m) => m.id) : null;
      // This station's items, plus ready-made ones no station prepares (bottled drinks etc.).
      setStock(all.filter((p) => !ids || !p.preparationStationId || ids.includes(p.preparationStationId)));
    } catch (e) {
      setStock([]);
      toast(errorText(e), 'error');
    }
  };

  const toggleStock = async (p: Product) => {
    const next = p.status === 'AVAILABLE' ? 'OUT_OF_STOCK' : 'AVAILABLE';
    setStock((xs) => xs && xs.map((x) => (x.id === p.id ? { ...x, status: next } : x)));
    try {
      await api.post(`/products/${p.id}/set-status`, { status: next });
    } catch (e) {
      toast(errorText(e), 'error');
      setStock((xs) => xs && xs.map((x) => (x.id === p.id ? p : x)));
    }
  };

  useEffect(() => {
    if (!branchId) return;
    api.get<Station[]>(`/kitchen/stations?branchId=${branchId}`).then(setStations).catch(() => undefined);
  }, [branchId]);

  const load = useCallback(async () => {
    if (!branchId) return;
    const q = `branchId=${branchId}${station ? `&stationId=${station}` : ''}`;
    try {
      const [list, rec] = await Promise.all([api.get<KdsTicket[]>(`/kitchen/tickets?${q}`), api.get<typeof recent>(`/kitchen/tickets/recent?${q}`)]);
      // Chime for tickets we haven't seen before (not on first load).
      if (seen.current) {
        const fresh = list.some((tk) => !seen.current!.has(tk.id));
        if (fresh) ring(3); // new ticket: ring 3 times
      }
      seen.current = new Set(list.map((tk) => tk.id));
      setTickets(list);
      setRecent(rec);
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }, [branchId, station, toast]);

  useEffect(() => {
    seen.current = null;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, station]);

  const live = useLive(branchId, ['ticket.updated'], () => load(), 15_000);

  // Keep the screen on while the KDS is open.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
    const request = () => nav.wakeLock?.request('screen').then((l) => (lock = l)).catch(() => undefined);
    request();
    const onVis = () => document.visibilityState === 'visible' && request();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      lock?.release().catch(() => undefined);
    };
  }, []);



  const act = async (tk: KdsTicket, action: 'acknowledge' | 'ready' | 'recall') => {
    setBusy(tk.id);
    try {
      await api.post(`/kitchen/tickets/${tk.id}/${action}`);
      await load();
    } catch (e) {
      toast(errorText(e), 'error');
      load();
    } finally {
      setBusy(null);
    }
  };

  const pickStation = (id: string) => {
    setStation(id);
    try {
      localStorage.setItem('kdsStation', id);
    } catch {
      /* ignore */
    }
  };

  return (
    <AppShell live={live} title={t('kds.title')} dark>
      <div className="flex h-full flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-kds-line px-3 py-2.5">
          <Segmented
            dark
            value={station}
            onChange={pickStation}
            options={
              locked
                ? mine.map((s) => ({ value: s.id, label: s.name }))
                : [{ value: '', label: t('kds.allStations') }, ...stations.map((s) => ({ value: s.id, label: s.name }))]
            }
          />
          <div className="ml-auto flex items-center gap-2">
            {can('product.status_update') && (
              <button onClick={openStock} className="inline-flex h-10 items-center gap-2 rounded-full bg-kds-card px-4 text-sm font-semibold text-kds-text hover:bg-kds-line">
                {t('kds.stock')}
              </button>
            )}
            {(() => {
              const open = tickets?.filter((x) => x.ticketType !== 'CANCELLATION') ?? [];
              const lateCount = open.filter((x) => minutesSince(x.firedAt, now) >= late).length;
              return (
                <span className="flex items-center gap-2 text-sm tnum">
                  <span className="text-kds-mute">{open.length} open</span>
                  {lateCount > 0 && <span className="rounded-full bg-kds-late px-2.5 py-1 font-bold text-white">{lateCount} late</span>}
                </span>
              );
            })()}
          </div>
        </div>

        <div className="flex-1 overflow-auto p-3">
          {!tickets ? (
            <PageSpinner />
          ) : tickets.length === 0 ? (
            <div className="grid h-full place-items-center text-center text-kds-mute">
              <div>
                <p className="text-2xl font-semibold text-kds-text">{t('kds.empty')}</p>
                <p className="mt-2 text-sm">New orders appear here and ring 3 times. Keep this screen open.</p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {tickets.map((tk) => {
                const mins = minutesSince(tk.firedAt, now);
                const isVoid = tk.ticketType === 'CANCELLATION';
                const head = isVoid ? 'bg-negative' : mins >= late ? 'bg-kds-late' : mins >= warn ? 'bg-kds-warn' : 'bg-kds-fresh';
                return (
                  <article key={tk.id} className={`flex flex-col overflow-hidden rounded-lg bg-kds-card ${isVoid ? 'ring-2 ring-negative' : ''}`}>
                    <header className={`flex items-center justify-between gap-2 px-4 py-3 ${head}`}>
                      <div className="min-w-0">
                        <p className="truncate font-display text-2xl font-black leading-none text-white">{tk.tableName}</p>
                        <p className="mt-1 text-xs text-white/75">
                          #{tk.orderNumber.split('-').pop()} · {tk.waiterName} {!station && `· ${tk.stationName}`}
                        </p>
                      </div>
                      <div className="text-right">
                        {isVoid ? (
                          <span className="rounded bg-white px-2 py-0.5 text-sm font-black text-negative">{t('kds.void')}</span>
                        ) : tk.ticketType === 'ADDITION' ? (
                          <span className="rounded bg-white/20 px-2 py-0.5 text-xs font-bold text-white">{t('kds.addition')}</span>
                        ) : null}
                        <p className="mt-1 font-mono text-xl font-medium text-white tnum">{mins}′</p>
                      </div>
                    </header>
                    <ul className="flex flex-1 flex-col gap-2 px-4 py-3">
                      {tk.items.map((it) => (
                        <li key={it.id} className={`text-lg leading-snug ${isVoid ? 'text-[#ffb4ab] line-through decoration-2' : 'text-kds-text'}`}>
                          <span className="mr-2 font-display font-black text-primary tnum">{it.quantity}×</span>
                          <span className="font-semibold">{it.productNameSnapshot}</span>
                          {it.modifiers.map((m) => (
                            <span key={m} className="block pl-8 text-base font-semibold text-warning">
                              + {m}
                            </span>
                          ))}
                          {it.notes && <span className="block pl-8 text-base font-bold text-warning">! {it.notes}</span>}
                        </li>
                      ))}
                    </ul>
                    <footer className="grid grid-cols-2 gap-2 p-3 pt-0">
                      {isVoid ? (
                        <button onClick={() => act(tk, 'acknowledge')} disabled={busy === tk.id} className="col-span-2 h-14 rounded-md bg-white text-lg font-black text-negative disabled:opacity-50">
                          {t('kds.dismiss')}
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={() => act(tk, 'acknowledge')}
                            disabled={busy === tk.id || tk.status !== 'PENDING'}
                            className={`h-14 rounded-md text-base font-bold ${tk.status === 'PENDING' ? 'bg-kds-line text-kds-text hover:brightness-125' : 'cursor-default border-2 border-kds-line bg-transparent text-kds-mute'}`}
                          >
                            {tk.status === 'PENDING' ? t('kds.start') : '● Cooking'}
                          </button>
                          <button onClick={() => act(tk, 'ready')} disabled={busy === tk.id} className="h-14 rounded-md bg-primary text-lg font-black text-ink disabled:opacity-50">
                            {t('kds.done')}
                          </button>
                        </>
                      )}
                    </footer>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        {recent.length > 0 && (
          <div className="hide-scrollbar flex items-center gap-2 overflow-x-auto border-t border-kds-line px-3 py-2">
            <span className="shrink-0 text-xs font-bold uppercase tracking-wider text-kds-mute">{t('kds.recall')}</span>
            {recent.map((r) => (
              <button
                key={r.id}
                onClick={() => act({ id: r.id } as KdsTicket, 'recall')}
                className="h-10 shrink-0 rounded-full bg-kds-card px-4 text-sm font-semibold text-kds-text hover:bg-kds-line"
              >
                {r.tableName} #{r.orderNumber.split('-').pop()}
              </button>
            ))}
          </div>
        )}
      </div>
      <Sheet open={stockOpen} onClose={() => setStockOpen(false)} title={t('kds.stock')} wide>
        <StockList items={stock} query={stockQuery} onQuery={setStockQuery} onToggle={toggleStock} />
      </Sheet>
    </AppShell>
  );
}

/** The "what's finished" list: search, grouped by category, one big switch per item. */
function StockList({ items, query, onQuery, onToggle }: { items: Product[] | null; query: string; onQuery: (q: string) => void; onToggle: (p: Product) => void }) {
  const { t } = useT();
  if (!items) return <PageSpinner />;

  const q = query.trim().toLowerCase();
  const shown = q ? items.filter((p) => p.name.toLowerCase().includes(q)) : items;
  const outCount = items.filter((p) => p.status !== 'AVAILABLE').length;
  const groups = new Map<string, Product[]>();
  for (const p of shown) {
    const key = p.category?.name ?? 'Other';
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-mute">{t('kds.stockHelp')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search items…"
          aria-label="Search items"
          className="h-11 min-w-0 flex-1 rounded-md border border-line bg-canvas px-3 text-base outline-none focus:border-ink"
        />
        <span className={`rounded-full px-3 py-1.5 text-sm font-semibold ${outCount ? 'bg-negative-bg text-negative' : 'bg-positive-bg text-positive'}`}>
          {outCount ? `${outCount} ${t('kds.finished').toLowerCase()}` : 'Everything available'}
        </span>
      </div>

      {items.length === 0 ? (
        <p className="rounded-md bg-canvas-soft px-4 py-8 text-center text-sm text-mute">No menu items are set up for this station yet. A manager can assign them in Manage → Menu.</p>
      ) : shown.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-mute">Nothing matches “{query}”.</p>
      ) : (
        [...groups.entries()].map(([cat, list]) => (
          <section key={cat} className="flex flex-col gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-mute">{cat}</h3>
            <ul className="flex flex-col gap-2">
              {list.map((p) => {
                const out = p.status !== 'AVAILABLE';
                return (
                  <li key={p.id}>
                    <button
                      onClick={() => onToggle(p)}
                      role="switch"
                      aria-checked={!out}
                      className={`flex w-full items-center gap-3 rounded-lg border-2 p-2 pr-3 text-left transition-colors ${out ? 'border-negative bg-negative-bg' : 'border-line bg-canvas hover:border-ink'}`}
                    >
                      {p.imageReference ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.imageReference} alt="" className={`h-12 w-12 shrink-0 rounded-md object-cover ${out ? 'grayscale' : ''}`} />
                      ) : (
                        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-md bg-canvas-sunk font-display text-lg font-black text-mute">{p.name.slice(0, 1).toUpperCase()}</span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-base font-semibold ${out ? 'text-negative-deep line-through decoration-2' : 'text-ink'}`}>{p.name}</span>
                        <span className={`text-sm font-bold ${out ? 'text-negative' : 'text-positive'}`}>{out ? t('kds.finished') : t('kds.inStock')}</span>
                      </span>
                      {/* switch */}
                      <span aria-hidden="true" className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${out ? 'bg-line' : 'bg-positive'}`}>
                        <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${out ? 'left-0.5' : 'left-[22px]'}`} />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
