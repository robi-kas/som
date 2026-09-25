'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useLive } from '@/lib/live';
import { AppShell } from '@/components/shell/AppShell';
import { Icon, type IconName } from '@/components/ui/Icon';
import { useRingOnIncrease } from '@/lib/sound';
import { Sheet } from '@/components/ui/Sheet';

const SECTIONS: { href: string; label: string; icon: IconName; permission: string }[] = [
  { href: '/admin', label: 'Today', icon: 'chart', permission: 'report.view' },
  { href: '/admin/approvals', label: 'Needs attention', icon: 'flag', permission: 'report.view' },
  { href: '/admin/reports', label: 'Reports', icon: 'receipt', permission: 'report.view_financial' },
  { href: '/admin/menu', label: 'Menu', icon: 'menu', permission: 'product.update' },
  { href: '/admin/tables', label: 'Tables', icon: 'tables', permission: 'table.update' },
  { href: '/admin/staff', label: 'Staff', icon: 'users', permission: 'user.manage' },
  { href: '/admin/printers', label: 'Kitchen & printers', icon: 'printer', permission: 'printer.view' },
  { href: '/admin/prints', label: 'Printed bills', icon: 'receipt', permission: 'receipt.view' },
  { href: '/admin/activity', label: 'Activity log', icon: 'log', permission: 'report.view' },
  { href: '/admin/settings', label: 'Settings', icon: 'settings', permission: 'report.view' },
];

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

        <nav className="hidden shrink-0 flex-col gap-1 overflow-y-auto border-r border-line bg-canvas px-3 py-4 md:flex md:w-56">
          {items.map((s) => {
            const on = isOn(s.href);
            return (
              <Link
                key={s.href}
                href={s.href}
                className={`flex h-10 shrink-0 items-center gap-2.5 rounded-md px-3 text-sm font-semibold ${on ? 'bg-ink text-white' : 'text-body hover:bg-canvas-sunk'}`}
              >
                <Icon name={s.icon} size={18} />
                {s.label}
                {s.href === '/admin/approvals' && !!attention && (
                  <span className={`ml-auto rounded-full px-2 text-xs ${on ? 'bg-primary text-ink' : 'bg-warning text-ink'}`}>{attention}</span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="min-w-0 flex-1 overflow-y-auto">{children}</div>
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
