'use client';

import { useMemo, useState } from 'react';
import type { Category, Product } from '@/lib/types';
import { useT } from '@/lib/i18n';
import { money } from '@/lib/format';
import { Segmented } from '@/components/ui/Segmented';
import { Icon } from '@/components/ui/Icon';

/**
 * Menu grid. Out-of-stock items stay visible (so waiters learn what's gone) but can't be tapped.
 * `counts` shows a lime badge with how many of each product are in the unsent cart.
 */
export function MenuBrowser({
  categories,
  products,
  counts,
  onPick,
}: {
  categories: Category[];
  products: Product[];
  counts: Record<string, number>;
  onPick: (p: Product) => void;
}) {
  const { t } = useT();
  const active = categories.filter((c) => c.isActive && products.some((p) => p.categoryId === c.id));
  const [cat, setCat] = useState<string>('');
  const [q, setQ] = useState('');
  const currentCat = cat || active[0]?.id || '';

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (needle) return products.filter((p) => p.name.toLowerCase().includes(needle));
    return products.filter((p) => p.categoryId === currentCat);
  }, [products, q, currentCat]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-2 border-b border-line bg-canvas px-3 pb-2.5 pt-3">
        <label className="relative block">
          <Icon name="search" size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-mute" />
          <input
            id="menu-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('order.searchMenu')}
            className="h-11 w-full rounded-md bg-canvas-sunk pl-10 pr-10 text-[16px] placeholder:text-mute focus:bg-canvas focus:outline-none focus:ring-2 focus:ring-primary"
          />
          {q && (
            <button onClick={() => setQ('')} aria-label="Clear search" className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-mute hover:bg-line">
              <Icon name="x" size={16} />
            </button>
          )}
        </label>
        {!q && <Segmented value={currentCat} onChange={setCat} options={active.map((c) => ({ value: c.id, label: c.name }))} />}
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
          {shown.map((p) => {
            const out = p.status !== 'AVAILABLE';
            const n = counts[p.id] ?? 0;
            return (
              <button
                key={p.id}
                disabled={out}
                onClick={() => onPick(p)}
                className={`relative flex min-h-[84px] flex-col justify-between overflow-hidden rounded-lg border bg-canvas text-left transition-transform active:scale-[0.97] ${
                  n ? 'border-ink ring-1 ring-ink' : 'border-line hover:border-body'
                } ${out ? 'cursor-not-allowed opacity-45' : ''} ${p.imageReference ? 'p-0' : 'p-3'}`}
              >
                {p.imageReference && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.imageReference} alt="" loading="lazy" className={`aspect-[4/3] w-full bg-canvas-sunk object-cover ${out ? 'grayscale' : ''}`} />
                )}
                <span className={`pr-6 text-[15px] font-semibold leading-snug ${p.imageReference ? 'px-3 pt-2' : ''}`}>{p.name}</span>
                <span className={`mt-1.5 flex items-center gap-1.5 text-sm tnum ${p.imageReference ? 'px-3 pb-2.5' : ''}`}>
                  {out ? (
                    <span className="font-semibold text-negative">{t('order.outOfStock')}</span>
                  ) : (
                    <>
                      <span className="text-body">{money(p.sellingPrice)}</span>
                      {p.modifiers.length > 0 && <span className="text-xs text-mute">+ options</span>}
                    </>
                  )}
                </span>
                {n > 0 && (
                  <span className="absolute right-2 top-2 grid h-7 min-w-[28px] place-items-center rounded-full bg-primary px-1.5 text-sm font-extrabold text-ink shadow-card ring-2 ring-canvas tnum">{n}</span>
                )}
              </button>
            );
          })}
        </div>
        {shown.length === 0 && <p className="py-12 text-center text-sm text-mute">Nothing matches “{q}”.</p>}
      </div>
    </div>
  );
}
