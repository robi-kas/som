'use client';

import type { OrderListRow } from '@/lib/types';
import { useT } from '@/lib/i18n';
import { elapsed, money } from '@/lib/format';
import { Pill } from '@/components/ui/Pill';

export function sortBills(rows: OrderListRow[]) {
  const rank = (o: OrderListRow) => (o.tableStatus === 'WAITING_FOR_PAYMENT' ? 0 : o.hasPendingVerification ? 1 : o.paymentStatus === 'PARTIALLY_PAID' ? 2 : 3);
  return [...rows].sort((a, b) => rank(a) - rank(b) || a.createdAt.localeCompare(b.createdAt));
}

export function BillList({ bills, selected, onSelect, now }: { bills: OrderListRow[]; selected: string | null; onSelect: (id: string) => void; now: number }) {
  const { t } = useT();
  if (bills.length === 0) return <p className="px-4 py-12 text-center text-sm text-mute">{t('cashier.noBills')}</p>;
  return (
    <ul className="flex flex-col gap-1.5 p-2">
      {bills.map((b) => {
        const on = b.id === selected;
        const asked = b.tableStatus === 'WAITING_FOR_PAYMENT';
        return (
          <li key={b.id}>
            <button
              onClick={() => onSelect(b.id)}
              aria-current={on}
              className={`flex w-full flex-col gap-1 rounded-md border px-3 py-2.5 text-left ${
                on ? 'border-ink bg-canvas shadow-[inset_4px_0_0_#9fe870]' : asked ? 'border-[#e8a15a] bg-state-bill/60 hover:border-ink' : 'border-line bg-canvas hover:border-body'
              }`}
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate font-display text-lg font-extrabold">{b.tableName}</span>
                <span className="font-semibold tnum">{money(b.balanceDue)}</span>
              </span>
              <span className="flex flex-wrap items-center gap-1.5 text-xs text-mute">
                {asked ? (
                  <Pill tone="warn">{t('cashier.billAsked')}</Pill>
                ) : b.hasPendingVerification ? (
                  <Pill tone="info">{t('cashier.pending')}</Pill>
                ) : b.paymentStatus === 'PARTIALLY_PAID' ? (
                  <Pill tone="lime">{t('cashier.partPaid')}</Pill>
                ) : (
                  <Pill>{t('cashier.eating')}</Pill>
                )}
                <span>#{b.orderNumber.split('-').pop()}</span>
                <span>· {b.waiterName}</span>
                <span className="ml-auto tnum">{elapsed(b.createdAt, now)}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
