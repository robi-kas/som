'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, errorText, setApprovalHandler } from '@/lib/api';
import { useT, type I18nKey } from '@/lib/i18n';
import { Sheet } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';

interface Pending {
  permission: string;
  resolve: (token: string | null) => void;
}

const ApprovalContext = createContext<((permission: string) => Promise<string | null>) | null>(null);

/**
 * "Manager approval" pad. Any API call that answers APPROVAL_REQUIRED opens this; the
 * manager types their username + PIN on this device, the API issues a one-time token
 * for that exact permission, and the original request is retried with it.
 */
export function ApprovalProvider({ children }: { children: ReactNode }) {
  const { t } = useT();
  const [pending, setPending] = useState<Pending | null>(null);
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pendingRef = useRef<Pending | null>(null);

  const request = useCallback((permission: string) => {
    return new Promise<string | null>((resolve) => {
      pendingRef.current?.resolve(null);
      const p = { permission, resolve };
      pendingRef.current = p;
      setPending(p);
      setPin('');
      setError('');
      try {
        setUsername(sessionStorage.getItem('lastApprover') ?? '');
      } catch {
        setUsername('');
      }
    });
  }, []);

  useEffect(() => {
    setApprovalHandler(request);
    return () => setApprovalHandler(null);
  }, [request]);

  const close = (token: string | null) => {
    pendingRef.current?.resolve(token);
    pendingRef.current = null;
    setPending(null);
    setPin('');
  };

  const submit = async () => {
    if (!pending || pin.length < 4 || !username) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.post<{ approvalToken: string }>('/approvals', { username: username.trim().toLowerCase(), pin, permission: pending.permission });
      try {
        sessionStorage.setItem('lastApprover', username.trim().toLowerCase());
      } catch {
        /* ignore */
      }
      close(res.approvalToken);
    } catch (e) {
      setError(errorText(e) || t('approval.denied'));
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  const press = (d: string) => setPin((p) => (p.length >= 6 ? p : p + d));
  const what = pending ? t(`perm.${pending.permission}` as I18nKey) : '';

  return (
    <ApprovalContext.Provider value={request}>
      {children}
      <Sheet open={!!pending} onClose={() => close(null)} title={t('approval.title')}>
        <div className="flex flex-col gap-4 pb-2">
          <p className="flex items-start gap-2 rounded-md bg-warning-bg p-3 text-sm text-warning-deep">
            <Icon name="lock" size={18} className="mt-0.5 shrink-0" />
            {t('approval.why', { what })}
          </p>
          <Input
            id="approver-username"
            autoComplete="off"
            autoCapitalize="none"
            placeholder={t('approval.manager')}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <div className="flex justify-center gap-3 py-1" aria-label={t('approval.pin')}>
            {Array.from({ length: 6 }).map((_, i) => (
              <span key={i} className={`h-3.5 w-3.5 rounded-full ${i < pin.length ? 'bg-ink' : 'bg-line'} ${i >= 4 ? 'opacity-60' : ''}`} />
            ))}
          </div>
          {error && <p className="text-center text-sm font-semibold text-negative">{error}</p>}
          <div className="grid grid-cols-3 gap-2">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
              <button key={d} onClick={() => press(d)} className="h-14 rounded-md bg-canvas-sunk font-display text-2xl font-bold hover:bg-line active:bg-line">
                {d}
              </button>
            ))}
            <button onClick={() => setPin('')} className="h-14 rounded-md text-sm font-semibold text-mute hover:bg-canvas-sunk">
              Clear
            </button>
            <button onClick={() => press('0')} className="h-14 rounded-md bg-canvas-sunk font-display text-2xl font-bold hover:bg-line">
              0
            </button>
            <button onClick={() => setPin((p) => p.slice(0, -1))} aria-label="Delete" className="grid h-14 place-items-center rounded-md text-mute hover:bg-canvas-sunk">
              <Icon name="back" />
            </button>
          </div>
          <Button size="xl" block onClick={submit} loading={busy} disabled={pin.length < 4 || !username}>
            {t('approval.approve')}
          </Button>
        </div>
      </Sheet>
    </ApprovalContext.Provider>
  );
}

/** Ask for a manager approval up front (for flows that want the token before calling the API). */
export function useApproval() {
  const ctx = useContext(ApprovalContext);
  if (!ctx) throw new Error('useApproval must be used inside ApprovalProvider');
  return ctx;
}
