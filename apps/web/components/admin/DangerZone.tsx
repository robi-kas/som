'use client';

import { useEffect, useState } from 'react';
import { api, errorText } from '@/lib/api';
import { Panel } from '@/components/admin/AdminShell';
import { Button } from '@/components/ui/Button';
import { Field, Input, PasswordInput } from '@/components/ui/Field';
import { Sheet } from '@/components/ui/Sheet';
import { useToast } from '@/components/ui/Toast';

type Scope = 'SALES' | 'EVERYTHING';

const WHAT: Record<Scope, { title: string; removes: string; keeps: string }> = {
  SALES: {
    title: 'Clear sales & money',
    removes: 'Every order, payment, refund, receipt, cash-drawer shift, kitchen ticket and print job. Order numbers start again from 1.',
    keeps: 'Menu, prices, tables, stations, printers, payment methods, staff and settings.',
  },
  EVERYTHING: {
    title: 'Full reset',
    removes: 'Everything above, plus the whole menu, tables, stations, printers, payment methods and every staff account except yours.',
    keeps: 'Your owner account, the cafe name, logo and settings.',
  },
};

/**
 * Owner-only reset, for clearing test data before going live. Off on live installs unless the
 * server explicitly allows it; needs the owner's password and the exact phrase.
 */
export function DangerZone() {
  const toast = useToast();
  const [status, setStatus] = useState<{ allowed: boolean; isOwner: boolean; confirmPhrase: string } | null>(null);
  const [scope, setScope] = useState<Scope | null>(null);
  const [phrase, setPhrase] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<typeof status>('/settings/reset').then(setStatus).catch(() => setStatus(null));
  }, []);

  if (!status?.isOwner) return null;

  const run = async () => {
    if (!scope) return;
    setBusy(true);
    try {
      const res = await api.post<{ removed: Record<string, number> }>('/settings/reset', { scope, confirmPhrase: phrase, password });
      const n = Object.values(res.removed).reduce((a, b) => a + b, 0);
      toast(`${WHAT[scope].title}: ${n.toLocaleString()} records removed`);
      setScope(null);
      setTimeout(() => window.location.assign('/admin'), 800);
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
      setPassword('');
    }
  };

  return (
    <Panel title={<span className="text-negative">Danger zone</span>} className="border-negative/40 lg:col-span-2">
      <p className="mb-4 max-w-2xl text-sm text-body">
        For clearing test data before the cafe goes live. This deletes records permanently — there is no undo. Once real sales are in, don’t: a business generally has to
        keep its sales records for tax purposes (ask your accountant how long), and deleted payments can hide theft.
      </p>
      {!status.allowed && (
        <p className="mb-4 rounded-md bg-warning-bg px-3 py-2 text-sm text-warning-deep">
          Switched off on this live install. To allow it, the server needs <code className="font-mono">ALLOW_DATA_RESET=true</code> — set it only for the few minutes you need it.
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {(Object.keys(WHAT) as Scope[]).map((s) => (
          <div key={s} className="flex flex-col gap-2 rounded-lg border border-line p-4">
            <p className="font-semibold">{WHAT[s].title}</p>
            <p className="text-sm text-body">
              <span className="font-semibold text-negative">Deletes:</span> {WHAT[s].removes}
            </p>
            <p className="text-sm text-body">
              <span className="font-semibold text-positive">Keeps:</span> {WHAT[s].keeps}
            </p>
            <Button
              variant="danger"
              className="mt-auto self-start"
              disabled={!status.allowed}
              onClick={() => {
                setPhrase('');
                setPassword('');
                setScope(s);
              }}
            >
              {WHAT[s].title}…
            </Button>
          </div>
        ))}
      </div>

      <Sheet
        open={!!scope}
        onClose={() => setScope(null)}
        title={scope ? WHAT[scope].title : ''}
        footer={
          <Button variant="danger" size="xl" block className="mb-1" loading={busy} disabled={phrase.trim() !== status.confirmPhrase || !password} onClick={run}>
            Delete permanently
          </Button>
        }
      >
        {scope && (
          <div className="flex flex-col gap-4">
            <p className="rounded-md bg-negative-bg p-3 text-sm text-negative">{WHAT[scope].removes} This cannot be undone.</p>
            <Field label={<>Type <span className="font-mono">{status.confirmPhrase}</span> to confirm</>} htmlFor="reset-phrase">
              <Input id="reset-phrase" autoComplete="off" value={phrase} onChange={(e) => setPhrase(e.target.value)} />
            </Field>
            <Field label="Your password" htmlFor="reset-password">
              <PasswordInput id="reset-password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
          </div>
        )}
      </Sheet>
    </Panel>
  );
}
