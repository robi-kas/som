'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Bottom sheet on phones, centred dialog on larger screens.
 * Escape and backdrop tap close it; focus moves inside while open.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  // Callers usually pass an inline `() => setOpen(false)`, a new function on every render.
  // Keep it in a ref so the effect below runs only when the sheet opens or closes; otherwise
  // every keystroke re-ran it and yanked the cursor back to the first field.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    document.addEventListener('keydown', onKey);
    // Focus the first field once, when it opens (not a field the person already clicked into).
    if (!panel.current?.contains(document.activeElement)) {
      const first = panel.current?.querySelector<HTMLElement>('input, select, textarea, button:not([data-close])');
      (first ?? panel.current)?.focus();
    }
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 animate-fade-in bg-ink/45" onClick={onClose} />
      <div
        ref={panel}
        tabIndex={-1}
        className={`relative flex max-h-[92vh] w-full animate-slide-up flex-col rounded-t-xl bg-canvas text-ink shadow-sheet outline-none sm:animate-fade-in sm:rounded-xl ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'}`}
      >
        {title !== undefined && (
          <div className="flex items-center justify-between gap-3 border-b border-line-soft px-5 py-4">
            <h2 className="font-display text-display-sm">{title}</h2>
            <button
              data-close
              onClick={onClose}
              aria-label="Close"
              className="-mr-2 grid h-10 w-10 place-items-center rounded-full text-mute hover:bg-canvas-sunk hover:text-ink"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="safe-bottom border-t border-line-soft px-5 pt-3">{footer}</div>}
      </div>
    </div>
  );
}
