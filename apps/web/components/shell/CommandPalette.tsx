'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon, type IconName } from '@/components/ui/Icon';

export interface Command {
  id: string;
  label: string;
  group: string;
  icon: IconName;
  keywords?: string;
  run: () => void;
}

/**
 * Ctrl+K / ⌘K: type a few letters to jump anywhere ("menu", "refund", "printed") or run an
 * action (sound, language, log out). Arrow keys to move, Enter to open, Esc to close.
 */
export function CommandPalette({ open, onClose, commands }: { open: boolean; onClose: () => void; commands: Command[] }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ('');
    setActive(0);
    const id = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return commands;
    return commands
      .map((c) => {
        const hay = `${c.label} ${c.group} ${c.keywords ?? ''}`.toLowerCase();
        if (!words.every((w) => hay.includes(w))) return null;
        // Names that start with what was typed come first.
        const score = c.label.toLowerCase().startsWith(words[0]) ? 0 : c.label.toLowerCase().includes(words[0]) ? 1 : 2;
        return { c, score };
      })
      .filter((x): x is { c: Command; score: number } => !!x)
      .sort((a, b) => a.score - b.score)
      .map((x) => x.c);
  }, [q, commands]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  const pick = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    c.run();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-ink/45 px-4 pt-[12vh]" onClick={onClose} role="dialog" aria-modal="true" aria-label="Quick search">
      <div className="w-full max-w-lg overflow-hidden rounded-xl bg-canvas text-ink shadow-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-line px-4">
          <Icon name="search" size={18} className="text-mute" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, shown.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                pick(shown[active]);
              } else if (e.key === 'Escape') {
                onClose();
              }
            }}
            placeholder="Go to… (menu, refund, printed bills, staff)"
            aria-label="Search pages and actions"
            className="h-14 w-full bg-transparent text-base outline-none placeholder:text-mute"
          />
          <kbd className="hidden rounded border border-line px-1.5 py-0.5 text-[11px] text-mute sm:block">Esc</kbd>
        </div>
        <ul ref={list} className="max-h-[50vh] overflow-y-auto py-2" role="listbox">
          {shown.length === 0 && <li className="px-4 py-8 text-center text-sm text-mute">Nothing matches “{q}”.</li>}
          {shown.map((c, i) => (
            <li key={c.id} data-index={i} role="option" aria-selected={i === active}>
              <button
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(c)}
                className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm ${i === active ? 'bg-primary-pale' : ''}`}
              >
                <Icon name={c.icon} size={18} className="shrink-0 text-mute" />
                <span className="min-w-0 flex-1 truncate font-semibold">{c.label}</span>
                <span className="shrink-0 text-xs text-mute">{c.group}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="hidden gap-4 border-t border-line-soft px-4 py-2 text-[11px] text-mute sm:flex">
          <span>↑↓ move</span>
          <span>↵ open</span>
          <span>Ctrl K anywhere</span>
        </div>
      </div>
    </div>
  );
}
