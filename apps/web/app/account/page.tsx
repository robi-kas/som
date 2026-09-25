'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api, errorText } from '@/lib/api';
import { useSession, homeFor } from '@/lib/session';
import { useToast } from '@/components/ui/Toast';
import { Button } from '@/components/ui/Button';
import { Field, Input, PasswordInput } from '@/components/ui/Field';
import { PageSpinner } from '@/components/ui/Spinner';

export default function AccountPage() {
  const { me, refresh, can, logout } = useSession();
  const router = useRouter();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pinPassword, setPinPassword] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState<'pw' | 'pin' | null>(null);

  if (!me) return <PageSpinner />;
  const forced = me.user.forcePasswordChange;
  const approver = ['order.void', 'refund.approve', 'order.discount_large', 'shift.approve_variance'].some(can);

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (next !== confirm) return toast('The two new passwords don’t match', 'error');
    setBusy('pw');
    try {
      await api.post('/auth/password', { currentPassword: current, newPassword: next });
      toast('Password changed. Other devices were signed out.');
      setCurrent('');
      setNext('');
      setConfirm('');
      await refresh();
      if (forced) router.replace(homeFor(me));
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setBusy(null);
    }
  };

  const setOwnPin = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('pin');
    try {
      await api.post('/auth/pin', { currentPassword: pinPassword, pin });
      toast('PIN saved. You can now approve on other people’s screens.');
      setPin('');
      setPinPassword('');
      await refresh();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-canvas-soft px-4 py-8">
      <div className="mx-auto flex max-w-md flex-col gap-6">
        <div className="flex items-center justify-between">
          {!forced ? (
            <button onClick={() => router.back()} className="text-sm font-semibold text-mute hover:text-ink">
              ← Back
            </button>
          ) : (
            <span />
          )}
          <button onClick={logout} className="text-sm font-semibold text-negative">
            Log out
          </button>
        </div>

        <form onSubmit={changePassword} className="flex flex-col gap-4 rounded-xl bg-canvas p-6 shadow-card">
          <div>
            <h1 className="font-display text-display-md">{forced ? 'Choose your own password' : 'Change password'}</h1>
            {forced && <p className="mt-1 text-sm text-mute">Your manager set a temporary password. Pick a new one only you know to continue.</p>}
          </div>
          <Field label="Current password" htmlFor="cur">
            <PasswordInput id="cur" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
          <Field label="New password" htmlFor="new" hint="At least 6 characters.">
            <PasswordInput id="new" autoComplete="new-password" minLength={6} required value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <Field label="New password again" htmlFor="confirm">
            <PasswordInput id="confirm" autoComplete="new-password" minLength={6} required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          <Button type="submit" size="lg" loading={busy === 'pw'}>
            Save password
          </Button>
        </form>

        {approver && !forced && (
          <form onSubmit={setOwnPin} className="flex flex-col gap-4 rounded-xl bg-canvas p-6 shadow-card">
            <div>
              <h2 className="font-display text-display-sm">Manager PIN {me.user.hasPin && <span className="text-sm font-normal text-positive">· set</span>}</h2>
              <p className="mt-1 text-sm text-mute">
                Lets you approve voids, big discounts and refunds right on a waiter’s or cashier’s screen. Every approval is logged with your name.
              </p>
            </div>
            <Field label="Your password" htmlFor="pinpw">
              <PasswordInput id="pinpw" autoComplete="current-password" required value={pinPassword} onChange={(e) => setPinPassword(e.target.value)} />
            </Field>
            <Field label="New PIN (4–6 digits)" htmlFor="pin">
              <Input id="pin" inputMode="numeric" pattern="\d{4,6}" maxLength={6} required value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
            </Field>
            <Button type="submit" variant="dark" size="lg" loading={busy === 'pin'}>
              Save PIN
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
