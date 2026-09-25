'use client';

import { useEffect, useState } from 'react';
import { uuid } from '@/lib/uuid';
import type { Product } from '@/lib/types';
import type { CartLine } from '@/lib/offline';
import { useT } from '@/lib/i18n';
import { fromCents, money, toCents } from '@/lib/format';
import { Sheet } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';

/** Pick add-ons, quantity and a note for one product (or edit an existing cart line). */
export function AddOnSheet({
  product,
  initial,
  onClose,
  onDone,
}: {
  product: Product | null;
  initial?: CartLine | null;
  onClose: () => void;
  onDone: (line: CartLine) => void;
}) {
  const { t } = useT();
  const [qty, setQty] = useState(1);
  const [mods, setMods] = useState<string[]>([]);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!product) return;
    setQty(initial?.quantity ?? 1);
    setMods(initial?.modifierIds ?? []);
    setNote(initial?.notes ?? '');
  }, [product, initial]);

  if (!product) return null;
  const chosen = product.modifiers.filter((m) => mods.includes(m.id));
  const modCents = chosen.reduce((a, m) => a + toCents(m.priceDelta), 0);
  const total = fromCents((toCents(product.sellingPrice) + modCents) * qty);

  const toggle = (id: string) => setMods((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));

  const done = () =>
    onDone({
      key: initial?.key ?? uuid(),
      productId: product.id,
      name: product.name,
      unitPrice: product.sellingPrice,
      quantity: qty,
      notes: note.trim() || undefined,
      modifierIds: chosen.map((m) => m.id),
      modifierNames: chosen.map((m) => m.name),
      modifierTotal: fromCents(modCents),
    });

  return (
    <Sheet
      open
      onClose={onClose}
      title={product.name}
      footer={
        <div className="flex items-center gap-3 pb-1">
          <div className="flex items-center rounded-full bg-canvas-sunk">
            <button aria-label="Less" onClick={() => setQty((q) => Math.max(1, q - 1))} className="grid h-12 w-12 place-items-center rounded-full hover:bg-line">
              <Icon name="minus" />
            </button>
            <span className="w-8 text-center font-display text-xl font-extrabold tnum">{qty}</span>
            <button aria-label="More" onClick={() => setQty((q) => Math.min(99, q + 1))} className="grid h-12 w-12 place-items-center rounded-full hover:bg-line">
              <Icon name="plus" />
            </button>
          </div>
          <Button size="xl" className="flex-1" onClick={done}>
            {t('order.addWith', { price: money(total) })}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {product.imageReference && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.imageReference} alt="" className="-mx-5 -mt-4 aspect-[16/9] w-[calc(100%+2.5rem)] max-w-none object-cover" />
        )}
        {product.description && <p className="text-sm text-body">{product.description}</p>}
        {product.modifiers.length > 0 && (
          <div className="flex flex-col gap-2">
            {product.modifiers.map((m) => {
              const on = mods.includes(m.id);
              return (
                <button
                  key={m.id}
                  onClick={() => toggle(m.id)}
                  aria-pressed={on}
                  className={`flex h-14 items-center justify-between rounded-md border-2 px-4 text-left font-semibold ${on ? 'border-ink bg-primary-pale' : 'border-line hover:border-body'}`}
                >
                  <span className="flex items-center gap-3">
                    <span className={`grid h-6 w-6 place-items-center rounded-sm border-2 ${on ? 'border-ink bg-ink text-primary' : 'border-line'}`}>
                      {on && <Icon name="check" size={16} strokeWidth={3} />}
                    </span>
                    {m.name}
                  </span>
                  <span className="text-sm text-body tnum">{Number(m.priceDelta) > 0 ? `+${money(m.priceDelta)}` : 'free'}</span>
                </button>
              );
            })}
          </div>
        )}
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">{t('common.note')}</span>
          <input
            id="line-note"
            value={note}
            maxLength={200}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('order.addNote')}
            className="h-12 rounded-md border border-line px-3.5 text-[16px] focus:border-ink focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </label>
      </div>
    </Sheet>
  );
}
