'use client';

import { useState } from 'react';
import { api, errorText, newIdempotencyKey } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import type { Shift } from '@/lib/types';

/** Shown instead of the till when the cashier hasn't opened their drawer yet. */
export function ShiftGate({ branchId, onOpened }: { branchId: string; onOpened: (s: Shift) => void }) {
  const { t } = useT();
  const toast = useToast();
  const [float, setFloat] = useState('');
  const [busy, setBusy] = useState(false);

  const open = async () => {
    setBusy(true);
    try {
      const s = await api.post<Shift>('/shifts/open', { branchId, openingFloat: float || '0' }, { headers: { 'Idempotency-Key': newIdempotencyKey() } });
      onOpened(s);
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-xl bg-canvas p-6 shadow-card">
        <h2 className="font-display text-display-md">{t('cashier.shiftClosed')}</h2>
        <p className="mt-1 text-sm text-mute">Count the cash in the drawer and enter it. This is your opening float; the drawer is checked against it at close.</p>
        <div className="mt-5 flex flex-col gap-4">
          <Field label={t('cashier.openingFloat')} htmlFor="float">
            <Input id="float" inputMode="decimal" placeholder="0.00" value={float} onChange={(e) => setFloat(e.target.value.replace(/[^\d.]/g, ''))} />
          </Field>
          <Button size="xl" block onClick={open} loading={busy} disabled={!/^\d+(\.\d{1,2})?$/.test(float || '0')}>
            {t('cashier.openShift')}
          </Button>
        </div>
      </div>
    </div>
  );
}
