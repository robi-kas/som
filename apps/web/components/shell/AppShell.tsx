'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { useSession } from '@/lib/session';
import { useT, type I18nKey } from '@/lib/i18n';
import type { LiveStatus } from '@/lib/live';
import { setSoundEnabled, useSoundState } from '@/lib/sound';
import { Icon, type IconName } from '@/components/ui/Icon';
import { PageSpinner } from '@/components/ui/Spinner';

interface NavItem {
  href: string;
  label: I18nKey;
  icon: IconName;
  permission: string;
}

const NAV: NavItem[] = [
  { href: '/pos/tables', label: 'nav.floor', icon: 'tables', permission: 'order.create' },
  { href: '/pos/cashier', label: 'nav.cashier', icon: 'cash', permission: 'payment.collect' },
  { href: '/pos/payments', label: 'nav.payments', icon: 'receipt', permission: 'payment.view' },
  { href: '/kds', label: 'nav.kitchen', icon: 'kitchen', permission: 'kds.view' },
  { href: '/admin', label: 'nav.admin', icon: 'chart', permission: 'report.view' },
];

/** The cafe's logo (or its initials) — top-left of every screen. */
export function CafeMark({ name, logoUrl, dark, size = 32 }: { name: string; logoUrl: string | null; dark?: boolean; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  return (
    <span className="mr-1 flex shrink-0 items-center gap-2" title={name}>
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt={name} className="rounded-md bg-white object-contain" style={{ width: size, height: size }} />
      ) : (
        <span
          className={`grid place-items-center rounded-md font-display text-sm font-black ${dark ? 'bg-primary text-ink' : 'bg-ink text-primary'}`}
          style={{ width: size, height: size }}
        >
          {initials || 'NC'}
        </span>
      )}
    </span>
  );
}

export function LiveDot({ status }: { status: LiveStatus }) {
  const { t } = useT();
  const cfg =
    status === 'live'
      ? { dot: 'bg-primary', text: t('common.online') }
      : status === 'offline'
        ? { dot: 'bg-negative', text: t('common.offline') }
        : { dot: 'bg-warning animate-pulse2', text: t('common.reconnecting') };
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-current" title={cfg.text}>
      <span className={`h-2 w-2 rounded-full ${cfg.dot}`} />
      <span className="hidden sm:inline">{cfg.text}</span>
    </span>
  );
}

/**
 * Frame for the floor screens (waiter, cashier). Top bar with the role switcher for people
 * who wear more than one hat, branch picker, live status, language and sign-out.
 */
export function AppShell({ children, live, title, dark }: { children: ReactNode; live?: LiveStatus; title?: ReactNode; dark?: boolean }) {
  const { me, loading, can, branch, setBranchId, logout } = useSession();
  const { t, lang, setLang } = useT();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const sound = useSoundState();

  if (loading || !me) return <PageSpinner />;
  const items = NAV.filter((n) => can(n.permission));

  return (
    <div className={`flex h-[100dvh] flex-col ${dark ? 'bg-kds-bg text-kds-text' : 'bg-canvas-soft text-ink'}`}>
      <header
        className={`flex h-14 shrink-0 items-center gap-2 px-3 sm:px-4 ${dark ? 'border-b border-kds-line bg-kds-bg' : 'border-b border-line bg-canvas'}`}
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <CafeMark name={me.organization.name} logoUrl={me.organization.logoUrl} dark={dark} />
        {items.length > 1 ? (
          <nav className="hide-scrollbar flex flex-1 gap-1 overflow-x-auto">
            {items.map((n) => {
              const on = pathname.startsWith(n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm font-semibold ${
                    on ? (dark ? 'bg-kds-card text-primary' : 'bg-ink text-white') : dark ? 'text-kds-mute hover:text-kds-text' : 'text-body hover:bg-canvas-sunk'
                  }`}
                >
                  <Icon name={n.icon} size={18} />
                  <span className="hidden sm:inline">{t(n.label)}</span>
                </Link>
              );
            })}
          </nav>
        ) : (
          <div className="flex-1 truncate font-display text-display-sm">{title}</div>
        )}

        {sound.enabled && !sound.unlocked && (
          <span className={`hidden items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold sm:inline-flex ${dark ? 'bg-kds-card text-warning' : 'bg-warning-bg text-warning-deep'}`}>
            <Icon name="volume" size={14} /> Tap anywhere for sound
          </span>
        )}
        {live && <LiveDot status={live} />}

        <div className="relative">
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className={`flex h-10 items-center gap-2 rounded-full pl-1 pr-3 text-sm font-semibold ${dark ? 'hover:bg-kds-card' : 'hover:bg-canvas-sunk'}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <span className={`grid h-8 w-8 place-items-center rounded-full text-xs font-bold ${dark ? 'bg-kds-card text-kds-text' : 'bg-primary-pale text-primary-deep'}`}>
              {me.user.displayName.slice(0, 2).toUpperCase()}
            </span>
            <span className="hidden max-w-[10rem] truncate md:inline">{me.user.displayName}</span>
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div role="menu" className="absolute right-0 top-12 z-50 w-64 overflow-hidden rounded-lg border border-line bg-canvas text-ink shadow-pop">
                <div className="border-b border-line-soft px-4 py-3">
                  <p className="font-semibold">{me.user.displayName}</p>
                  <p className="text-xs text-mute">
                    {me.roleNames.join(', ')} · {branch?.name}
                  </p>
                </div>
                {me.branches.length > 1 && (
                  <div className="border-b border-line-soft px-4 py-2">
                    {me.branches.map((b) => (
                      <button
                        key={b.id}
                        onClick={() => {
                          setBranchId(b.id);
                          setMenuOpen(false);
                        }}
                        className={`block w-full rounded-sm px-2 py-2 text-left text-sm ${b.id === branch?.id ? 'font-bold' : 'hover:bg-canvas-soft'}`}
                      >
                        {b.name}
                      </button>
                    ))}
                  </div>
                )}
                <button role="menuitem" onClick={() => setSoundEnabled(!sound.enabled)} className="flex w-full items-center justify-between px-4 py-3 text-left text-sm hover:bg-canvas-soft">
                  <span className="flex items-center gap-2">
                    <Icon name="volume" size={16} /> Notification sound
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${sound.enabled ? 'bg-positive-bg text-positive' : 'bg-canvas-sunk text-mute'}`}>{sound.enabled ? 'On' : 'Off'}</span>
                </button>
                <button role="menuitem" onClick={() => setLang(lang === 'am' ? 'en' : 'am')} className="block w-full px-4 py-3 text-left text-sm hover:bg-canvas-soft">
                  {t('common.language')}
                </button>
                <Link role="menuitem" href="/account" className="block px-4 py-3 text-sm hover:bg-canvas-soft">
                  Password &amp; PIN
                </Link>
                <button role="menuitem" onClick={logout} className="block w-full px-4 py-3 text-left text-sm font-semibold text-negative hover:bg-negative-bg">
                  {t('common.logout')}
                </button>
              </div>
            </>
          )}
        </div>
      </header>
      <main className="relative flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
