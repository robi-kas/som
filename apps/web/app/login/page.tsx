'use client';

import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError, errorText } from '@/lib/api';
import { useSession, homeFor } from '@/lib/session';
import { useT } from '@/lib/i18n';
import type { Me } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { Field, Input, PasswordInput } from '@/components/ui/Field';

function LoginForm() {
  const { t, lang, setLang } = useT();
  const { me, refresh } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const [cafe, setCafe] = useState('default');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showCafe, setShowCafe] = useState(false);
  const [brand, setBrand] = useState<{ name: string; logoUrl: string | null } | null>(null);

  // The cafe's own name and logo on the sign-in screen.
  useEffect(() => {
    const code = cafe.trim();
    if (!code) return;
    const t = setTimeout(() => {
      api
        .get<{ name: string; logoUrl: string | null }>(`/branding?org=${encodeURIComponent(code)}`, { redirectOn401: false })
        .then(setBrand)
        .catch(() => setBrand(null));
    }, 250);
    return () => clearTimeout(t);
  }, [cafe]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('cafeCode');
      if (saved) setCafe(saved);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (me) router.replace(params.get('next') || homeFor(me));
  }, [me, router, params]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/login', { organizationSlug: cafe.trim(), username: username.trim().toLowerCase(), password }, { redirectOn401: false });
      try {
        localStorage.setItem('cafeCode', cafe.trim());
      } catch {
        /* ignore */
      }
      await refresh();
      const next = await api.get<Me>('/auth/me', { redirectOn401: false });
      const target = params.get('next');
      router.replace(target && target !== '/login' ? target : homeFor(next));
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? t('login.failed') : errorText(err));
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-[100dvh] bg-ink lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden flex-col justify-between overflow-hidden p-12 text-white lg:flex">
        {brand?.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={brand.logoUrl} alt={brand.name} className="h-16 w-16 rounded-lg bg-white object-contain p-1" />
        ) : (
          <span className="grid h-12 w-12 place-items-center rounded-lg bg-primary font-display text-lg font-black text-ink">NC</span>
        )}
        <div>
          <h1 className="max-w-lg font-display text-[56px] font-black leading-[0.98] tracking-tight">
            Every table, every order, <span className="text-primary">one screen.</span>
          </h1>
          <p className="mt-5 max-w-md text-lg text-[#b9bdb4]">Orders go straight to the kitchen, bills are exact to the santim, and the drawer balances at close.</p>
        </div>
        <p className="font-mono text-xs text-[#6f736c]">{brand?.name ?? 'New Chapter POS'}</p>
      </section>

      <section className="flex items-center justify-center bg-canvas-soft px-5 py-10 lg:rounded-l-[32px]">
        <form onSubmit={submit} className="w-full max-w-sm">
          <div className="mb-8 flex items-center justify-between">
            <span className="flex items-center gap-2 lg:hidden">
              {brand?.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={brand.logoUrl} alt="" className="h-11 w-11 rounded-lg bg-white object-contain" />
              ) : (
                <span className="grid h-11 w-11 place-items-center rounded-lg bg-ink font-display font-black text-primary">NC</span>
              )}
              {brand?.name && <span className="font-display text-lg font-extrabold">{brand.name}</span>}
            </span>
            <button type="button" onClick={() => setLang(lang === 'am' ? 'en' : 'am')} className="ml-auto rounded-full bg-canvas-sunk px-4 py-2 text-sm font-semibold hover:bg-line">
              {t('common.language')}
            </button>
          </div>
          <h2 className="font-display text-display-lg">{t('login.title')}</h2>

          <div className="mt-6 flex flex-col gap-4">
            <Field label={t('login.username')} htmlFor="username">
              <Input id="username" autoComplete="username" autoCapitalize="none" autoCorrect="off" required value={username} onChange={(e) => setUsername(e.target.value)} />
            </Field>
            <Field label={t('login.password')} htmlFor="password">
              <PasswordInput id="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            {showCafe ? (
              <Field label={t('login.cafe')} htmlFor="cafe">
                <Input id="cafe" autoCapitalize="none" value={cafe} onChange={(e) => setCafe(e.target.value)} />
              </Field>
            ) : (
              <button type="button" onClick={() => setShowCafe(true)} className="self-start text-sm text-mute underline-offset-2 hover:underline">
                {t('login.cafe')}: {cafe}
              </button>
            )}
            {error && (
              <p role="alert" className="rounded-md bg-negative-bg px-3 py-2.5 text-sm font-medium text-negative">
                {error}
              </p>
            )}
            <Button type="submit" size="xl" block loading={busy} className="mt-2">
              {t('login.submit')}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
