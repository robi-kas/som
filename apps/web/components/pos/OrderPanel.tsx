'use client';

import type { OrderDetail, OrderItem } from '@/lib/types';
import type { CartLine } from '@/lib/offline';
import { useT, type I18nKey } from '@/lib/i18n';
import { fromCents, money, toCents } from '@/lib/format';
import { Icon } from '@/components/ui/Icon';
import { Pill, type Tone } from '@/components/ui/Pill';

const ITEM_TONE: Record<string, Tone> = {
  PENDING: 'neutral',
  SENT_TO_KITCHEN: 'info',
  PREPARING: 'warn',
  READY: 'good',
  SERVED: 'neutral',
  CANCELLED: 'bad',
};

export function cartTotal(lines: CartLine[]) {
  return fromCents(lines.reduce((a, l) => a + (toCents(l.unitPrice) + toCents(l.modifierTotal)) * l.quantity, 0));
}

/**
 * The order: unsent lines (the waiter's local cart, freely editable) on top, then what the
 * kitchen already has, each with its status. Ready items get a one-tap "served".
 */
export function OrderPanel({
  order,
  cart,
  onEditLine,
  onChangeQty,
  onServe,
  onVoid,
  busyItem,
}: {
  order: OrderDetail | null;
  cart: CartLine[];
  onEditLine: (l: CartLine) => void;
  onChangeQty: (key: string, delta: number) => void;
  onServe: (itemId: string) => void;
  onVoid: (item: OrderItem) => void;
  busyItem: string | null;
}) {
  const { t } = useT();
  const sent = (order?.items ?? []).filter((i) => i.status !== 'CANCELLED' && i.status !== 'VOIDED');
  const removed = (order?.items ?? []).filter((i) => i.status === 'CANCELLED');

  return (
    <div className="flex flex-col">
      {cart.length > 0 && (
        <section>
          <h3 className="px-4 pb-1 pt-4 text-xs font-bold uppercase tracking-wider text-mute">{t('order.status.PENDING')}</h3>
          <ul>
            {cart.map((l) => (
              <li key={l.key} className="flex items-center gap-2 border-b border-line-soft px-4 py-2.5">
                <button onClick={() => onEditLine(l)} className="min-w-0 flex-1 text-left">
                  <span className="block font-semibold leading-tight">{l.name}</span>
                  {(l.modifierNames.length > 0 || l.notes) && (
                    <span className="block truncate text-sm text-body">
                      {[...l.modifierNames.map((n) => `+ ${n}`), l.notes ? `“${l.notes}”` : ''].filter(Boolean).join('  ')}
                    </span>
                  )}
                  <span className="text-sm text-mute tnum">{money(fromCents((toCents(l.unitPrice) + toCents(l.modifierTotal)) * l.quantity))}</span>
                </button>
                <div className="flex shrink-0 items-center rounded-full bg-canvas-sunk">
                  <button aria-label="One less" onClick={() => onChangeQty(l.key, -1)} className="grid h-11 w-11 place-items-center rounded-full hover:bg-line">
                    <Icon name={l.quantity === 1 ? 'x' : 'minus'} size={18} />
                  </button>
                  <span className="w-6 text-center font-bold tnum">{l.quantity}</span>
                  <button aria-label="One more" onClick={() => onChangeQty(l.key, 1)} className="grid h-11 w-11 place-items-center rounded-full hover:bg-line">
                    <Icon name="plus" size={18} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {sent.length > 0 && (
        <section>
          <h3 className="px-4 pb-1 pt-4 text-xs font-bold uppercase tracking-wider text-mute">{t('order.onTable')}</h3>
          <ul>
            {sent.map((i) => (
              <li key={i.id} className={`flex items-center gap-3 border-b border-line-soft px-4 py-2.5 ${i.status === 'SERVED' ? 'opacity-60' : ''}`}>
                <span className="w-7 shrink-0 font-display text-lg font-extrabold tnum">{i.quantity}×</span>
                <div className="min-w-0 flex-1">
                  <span className="block font-semibold leading-tight">{i.productNameSnapshot}</span>
                  {(i.modifiers.length > 0 || i.notes) && (
                    <span className="block truncate text-sm text-body">
                      {[...i.modifiers.map((m) => `+ ${m.name}`), i.notes ? `“${i.notes}”` : ''].filter(Boolean).join('  ')}
                    </span>
                  )}
                  <span className="mt-0.5 flex items-center gap-2">
                    <Pill tone={ITEM_TONE[i.status] ?? 'neutral'}>{t(`order.status.${i.status}` as I18nKey)}</Pill>
                    <span className="text-xs text-mute tnum">{money(i.lineTotal)}</span>
                  </span>
                </div>
                {i.status === 'READY' && order?.canEdit && (
                  <button
                    onClick={() => onServe(i.id)}
                    disabled={busyItem === i.id}
                    className="h-11 shrink-0 rounded-md bg-primary px-3 text-sm font-bold text-ink disabled:opacity-50"
                  >
                    {t('order.serve')}
                  </button>
                )}
                {order?.canEdit && i.status !== 'SERVED' && i.status !== 'READY' && (
                  <button
                    onClick={() => onVoid(i)}
                    aria-label={`${t('order.remove')} ${i.productNameSnapshot}`}
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-mute hover:bg-negative-bg hover:text-negative"
                  >
                    <Icon name={i.status === 'PENDING' ? 'x' : 'lock'} size={18} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {removed.length > 0 && (
        <p className="px-4 pt-3 text-xs text-mute">
          {t('order.status.CANCELLED')}: {removed.map((r) => `${r.quantity}× ${r.productNameSnapshot}`).join(', ')}
        </p>
      )}

      {order && (
        <dl className="mt-3 flex flex-col gap-1 px-4 pb-4 text-sm tnum">
          <Row label={t('common.subtotal')} value={money(order.subtotal)} />
          {Number(order.discountAmount) > 0 && <Row label={t('common.discount')} value={`−${money(order.discountAmount)}`} />}
          {Number(order.serviceChargeAmount) > 0 && <Row label={t('common.service')} value={money(order.serviceChargeAmount)} />}
          <Row label={t('common.vat')} value={money(order.taxAmount)} />
          <div className="mt-1 flex items-baseline justify-between border-t border-line pt-2">
            <dt className="font-semibold">{t('common.total')}</dt>
            <dd className="font-display text-display-sm">{money(order.totalAmount, { currency: order.currency })}</dd>
          </div>
          {cart.length > 0 && <p className="text-right text-xs text-mute">+ {money(cartTotal(cart))} not sent yet (before VAT/service)</p>}
        </dl>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-body">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
