'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { api, ApiError, setUnauthorizedHandler } from './api';
import type { Me } from './types';

interface SessionValue {
  me: Me | null;
  loading: boolean;
  branchId: string;
  branch: Me['branches'][number] | null;
  setBranchId: (id: string) => void;
  can: (permission: string) => boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);
const PUBLIC_PATHS = ['/login'];

/** Where each person lands after signing in. */
export function homeFor(me: Me): string {
  const p = new Set(me.permissions);
  if (p.has('org.admin') || p.has('report.view')) return '/admin';
  if (p.has('payment.collect')) return '/pos/cashier';
  if (p.has('kds.update') && !p.has('order.create')) return '/kds';
  if (p.has('order.create')) return '/pos/tables';
  return '/login';
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [branchId, setBranchIdState] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await api.get<Me>('/auth/me', { redirectOn401: false });
      setMe(data);
      let saved = '';
      try {
        saved = localStorage.getItem('branchId') ?? '';
      } catch {
        /* ignore */
      }
      const valid = data.branches.find((b) => b.id === saved);
      setBranchIdState(valid ? valid.id : (data.branches[0]?.id ?? ''));
    } catch (e) {
      setMe(null);
      if (!(e instanceof ApiError && (e.status === 401 || e.status === 403))) console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setMe(null);
      if (!PUBLIC_PATHS.includes(window.location.pathname)) {
        router.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
      }
    });
    return () => setUnauthorizedHandler(null);
  }, [router]);

  // Route guard: not signed in → login; forced password change → account page.
  useEffect(() => {
    if (loading) return;
    if (!me && !PUBLIC_PATHS.includes(pathname)) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    } else if (me?.user.forcePasswordChange && pathname !== '/account') {
      router.replace('/account');
    }
  }, [loading, me, pathname, router]);

  const setBranchId = useCallback((id: string) => {
    setBranchIdState(id);
    try {
      localStorage.setItem('branchId', id);
    } catch {
      /* ignore */
    }
  }, []);

  const can = useCallback(
    (permission: string) => !!me && (me.permissions.includes(permission) || me.permissions.includes('org.admin')),
    [me],
  );

  useEffect(() => {
    if (me?.organization.name) document.title = `${me.organization.name} · POS`;
  }, [me?.organization.name]);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout', {}, { redirectOn401: false });
    } catch {
      /* already gone */
    }
    setMe(null);
    router.replace('/login');
  }, [router]);

  const value = useMemo<SessionValue>(
    () => ({
      me,
      loading,
      branchId,
      branch: me?.branches.find((b) => b.id === branchId) ?? null,
      setBranchId,
      can,
      refresh: load,
      logout,
    }),
    [me, loading, branchId, setBranchId, can, load, logout],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}
