'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useLive } from '@/lib/live';
import { AppShell } from '@/components/shell/AppShell';
import { Icon } from '@/components/ui/Icon';
import { useRingOnIncrease } from '@/lib/sound';
import { Sheet } from '@/components/ui/Sheet';
import { ADMIN_SECTIONS } from '@/lib/nav';

const SECTIONS = ADMIN_SECTIONS;

interface Attention {
  paymentVerifications: number;
  refundApprovals: number;
  drawerVariances: number;
  lateTickets: number;
  printerProblems: number;
}

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { can, branchId } = useSession();
  const [attention, setAttention] = useState<number | null>(null);
  useRingOnIncrease(attention);

  const load = useCallback(async () => {
    if (!branchId || !can('report.view')) return;
    try {
      const d = await api.get<{ needsAttention: Attention }>(`/reports/dashboard?branchId=${branchId}`);
      const a = d.needsAttention;
      setAttention(a.paymentVerifications + a.refundApprovals + a.drawerVariances + a.printerProblems);
    } catch {
      /* the page itself shows errors */
    }
  }, [branchId, can]);

  useEffect(() => {
    load();
  }, [load]);
  const live = useLive(branchId, ['payment.updated', 'printer.updated', 'order.updated'], () => load(), 60_000);

  const items = SECTIONS.filter((s) => can(s.permission));
  const isOn = (href: string) => (href === '/admin' ? pathname === '/admin' : pathname.startsWith(href));
  const current = items.find((s) => isOn(s.href)) ?? items[0];
  const [picker, setPicker] = useState(false);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    try {
      setNarrow(localStorage.getItem('adminSidebar') === 'narrow');
    } catch {
      /* private mode: default wide */
    }
  }, []);
  const toggleNarrow = () =>
    setNarrow((n) => {
      try {
        localStorage.setItem('adminSidebar', n ? 'wide' : 'narrow');
      } catch {
        /* ignore */
      }
      return !n;
    });
  // Close the section picker after navigating.
  useEffect(() => setPicker(false), [pathname]);

  return (
    <AppShell live={live}>
      <div className="flex h-full flex-col md:flex-row">
        {/* Phone: one button showing where you are; tap it for every section. */}
        <div className="shrink-0 border-b border-line bg-canvas px-3 py-2 md:hidden">
          <button
            onClick={() => setPicker(true)}
            aria-haspopup="dialog"
            className="flex h-11 w-full items-center gap-2.5 rounded-lg border border-line px-3 text-left text-sm font-semibold hover:border-ink"
          >
            {current && <Icon name={current.icon} size={18} />}
            <span className="min-w-0 flex-1 truncate">{current?.label}</span>
            {!!attention && current?.href !== '/admin/approvals' && <span className="rounded-full bg-warning px-2 text-xs text-ink">{attention}</span>}
            <span className="text-mute" aria-hidden="true">
              ☰
            </span>
            <span className="sr-only">Show all sections</span>
          </button>
        </div>
        <Sheet open={picker} onClose={() => setPicker(false)} title="Manage">
          <div className="grid grid-cols-2 gap-2 pb-2">
            {items.map((s) => {
              const on = isOn(s.href);
              return (
                <Link
                  key={s.href}
                  href={s.href}
                  onClick={() => setPicker(false)}
                  className={`relative flex min-h-[76px] flex-col justify-between gap-2 rounded-lg border p-3 text-sm font-semibold ${on ? 'border-ink bg-ink text-white' : 'border-line hover:border-ink'}`}
                >
                  <Icon name={s.icon} size={20} />
                  <span className="leading-tight">{s.label}</span>
                  {s.href === '/admin/approvals' && !!attention && (
                    <span className="absolute right-2 top-2 rounded-full bg-warning px-2 text-xs text-ink">{attention}</span>
                  )}
                </Link>
              );
            })}
          </div>
        </Sheet>

        {/* Desktop: grouped sidebar; collapses to icons for more room (remembered). */}
        <nav
          aria-label="Manage sections"
          className={`hidden shrink-0 flex-col overflow-y-auto border-r border-line bg-canvas py-4 transition-[width] md:flex ${narrow ? 'md:w-[68px] px-2' : 'md:w-60 px-3'}`}
        >
          {(['Today', 'Money', 'Setup'] as const).map((group) => {
            const inGroup = items.filter((s) => s.group === group);
            if (!inGroup.length) return null;
            return (
              <div key={group} className="mb-3 flex flex-col gap-0.5">
                {narrow ? (
                  <div className="mx-2 mb-1 border-t border-line-soft first:border-0" />
                ) : (
                  <p className="px-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-mute">{group}</p>
                )}
                {inGroup.map((s) => {
                  const on = isOn(s.href);
                  const badge = s.href === '/admin/approvals' && !!attention;
                  return (
                    <Link
                      key={s.href}
                      href={s.href}
                      title={narrow ? s.label : undefined}
                      aria-current={on ? 'page' : undefined}
                      className={`relative flex h-10 shrink-0 items-center gap-2.5 rounded-md text-sm font-semibold ${narrow ? 'justify-center' : 'px-3'} ${
                        on ? 'bg-ink text-white' : 'text-body hover:bg-canvas-sunk'
                      }`}
                    >
                      <Icon name={s.icon} size={18} />
                      {!narrow && <span className="truncate">{s.label}</span>}
                      {badge &&
                        (narrow ? (
                          <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-warning ring-2 ring-canvas" aria-label={`${attention} need attention`} />
                        ) : (
                          <span className={`ml-auto rounded-full px-2 text-xs ${on ? 'bg-primary text-ink' : 'bg-warning text-ink'}`}>{attention}</span>
                        ))}
                    </Link>
                  );
                })}
              </div>
            );
          })}
          <button
            onClick={toggleNarrow}
            className={`mt-auto flex h-9 items-center gap-2 rounded-md text-xs font-semibold text-mute hover:bg-canvas-sunk hover:text-ink ${narrow ? 'justify-center' : 'px-3'}`}
            aria-label={narrow ? 'Expand sidebar' : 'Collapse sidebar'}
            title={narrow ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <span aria-hidden="true" className={`inline-block transition-transform ${narrow ? 'rotate-180' : ''}`}>
              «
            </span>
            {!narrow && 'Collapse'}
          </button>
        </nav>
        {/* Wide monitors: keep pages at a readable width instead of stretching edge to edge. */}
        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1440px]">{children}</div>
        </div>
      </div>
    </AppShell>
  );
}

export function PageHeader({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 px-4 pb-4 pt-6 sm:px-8">
      <div>
        <h1 className="font-display text-display-lg">{title}</h1>
        {sub && <p className="mt-1 text-sm text-mute">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ title, children, actions, className = '' }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-canvas ${className}`}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 border-b border-line-soft px-5 py-3.5">
          {title && <h2 className="font-display text-display-sm">{title}</h2>}
          {actions}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}
