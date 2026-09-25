'use client';

import { money } from '@/lib/format';
import { Sheet } from '@/components/ui/Sheet';
import { Pill } from '@/components/ui/Pill';
import { ReferenceEditor } from '@/components/cashier/ReferenceEditor';

export interface MissingRef {
  id: string;
  orderNumber: string;
  tableName: string;
  methodName: string;
  appliedAmount: string;
  status: string;
  createdAt: string;
  mine: boolean;
  receivedByName: string;
}

/** Telebirr / bank payments taken without a transaction number, to fill in before closing the drawer. */
export function MissingReferencesSheet({ open, onClose, rows, onSaved }: { open: boolean; onClose: () => void; rows: MissingRef[]; onSaved: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Needs transaction number">
      <div className="flex flex-col gap-3 p-5">
        <p className="text-sm text-mute">
          These payments were taken without the transaction number. Find each one in the Telebirr or bank app and type the number in. You can’t close your drawer
          until yours are done.
        </p>
        {rows.length === 0 && <p className="rounded-md bg-positive-bg px-3 py-2 text-sm font-semibold text-positive">All done — every payment has its number.</p>}
        {rows.map((r) => (
          <div key={r.id} className="flex flex-col gap-2 rounded-md border border-line p-3">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="min-w-0">
                <span className="font-semibold">{r.methodName}</span> · {r.tableName}
                <span className="block text-xs text-mute">
                  #{r.orderNumber.split('-').pop()} · {new Date(r.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  {!r.mine && ` · taken by ${r.receivedByName}`}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {r.status === 'PENDING_VERIFICATION' && <Pill tone="warn">Not verified</Pill>}
                <span className="font-semibold tnum">{money(r.appliedAmount)}</span>
              </span>
            </div>
            <ReferenceEditor paymentId={r.id} onSaved={onSaved} />
          </div>
        ))}
      </div>
    </Sheet>
  );
}
