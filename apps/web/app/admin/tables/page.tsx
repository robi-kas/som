'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, errorText } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { FloorTable } from '@/lib/types';
import { PageHeader } from '@/components/admin/AdminShell';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { Pill } from '@/components/ui/Pill';
import { PageSpinner, LoadFailed } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';

type AdminTable = FloorTable & { isActive: boolean };

export default function TablesAdminPage() {
  const { branchId } = useSession();
  const toast = useToast();
  const [failed, setFailed] = useState<string | null>(null);
  const [tables, setTables] = useState<AdminTable[] | null>(null);
  const [name, setName] = useState('');
  const [capacity, setCapacity] = useState('4');

  const load = useCallback(async () => {
    if (!branchId) return;
    try {
      setFailed(null);
      setTables(await api.get<AdminTable[]>(`/tables?branchId=${branchId}&includeInactive=true`));
    } catch (e) {
      setFailed(errorText(e));
      toast(errorText(e), 'error');
    }
  }, [branchId, toast]);
  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok);
      load();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };

  if (!tables) return failed ? <LoadFailed message={failed} onRetry={() => load()} /> : <PageSpinner />;

  return (
    <div className="pb-10">
      <PageHeader title="Tables" sub="What waiters see on the floor. A table with an open order can’t be removed." />
      <div className="flex flex-col gap-4 px-4 sm:px-8">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(() => api.post('/tables', { branchId, name: name.trim(), capacity: parseInt(capacity, 10) || 2 }), `Table ${name} added`).then(() => setName(''));
          }}
          className="flex flex-wrap items-end gap-2 rounded-xl border border-line bg-canvas p-4"
        >
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Name
            <Input id="t-name" className="w-40" placeholder="e.g. T9 or Terrace 2" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Seats
            <Input id="t-cap" className="w-24" inputMode="numeric" value={capacity} onChange={(e) => setCapacity(e.target.value.replace(/\D/g, ''))} />
          </label>
          <Button type="submit" size="lg" disabled={!name.trim()}>
            Add table
          </Button>
        </form>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {tables.map((tb) => (
            <div key={tb.id} className={`flex flex-col gap-2 rounded-lg border border-line bg-canvas p-3 ${tb.isActive ? '' : 'opacity-50'}`}>
              <div className="flex items-start justify-between">
                <span className="font-display text-2xl font-black">{tb.name}</span>
                <span className="text-xs text-mute">{tb.capacity} seats</span>
              </div>
              {!tb.isActive ? (
                <Pill>Removed</Pill>
              ) : tb.status === 'OUT_OF_SERVICE' ? (
                <Pill tone="warn">Closed off</Pill>
              ) : tb.activeOrderId ? (
                <Pill tone="info">In use</Pill>
              ) : (
                <Pill tone="good">Free</Pill>
              )}
              <div className="mt-auto flex flex-wrap gap-1">
                {tb.isActive && !tb.activeOrderId && (
                  <>
                    <button
                      className="text-xs font-semibold text-mute hover:text-ink"
                      onClick={() =>
                        run(
                          () => api.post(`/tables/${tb.id}/set-status`, { status: tb.status === 'OUT_OF_SERVICE' ? 'AVAILABLE' : 'OUT_OF_SERVICE' }),
                          tb.status === 'OUT_OF_SERVICE' ? 'Table open again' : 'Table closed off',
                        )
                      }
                    >
                      {tb.status === 'OUT_OF_SERVICE' ? 'Open' : 'Close off'}
                    </button>
                    <span className="text-xs text-line">·</span>
                    <button className="text-xs font-semibold text-negative" onClick={() => run(() => api.post(`/tables/${tb.id}/deactivate`), 'Table removed')}>
                      Remove
                    </button>
                  </>
                )}
                {!tb.isActive && (
                  <button className="text-xs font-semibold text-mute hover:text-ink" onClick={() => run(() => api.post(`/tables/${tb.id}/activate`), 'Table restored')}>
                    Restore
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
