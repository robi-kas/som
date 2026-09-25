'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type Kind = 'ok' | 'error' | 'info';
interface ToastItem {
  id: number;
  kind: Kind;
  text: string;
}

const ToastContext = createContext<((text: string, kind?: Kind) => void) | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, kind: Kind = 'ok') => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs.slice(-2), { id, kind, text }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3000);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-4">
        {items.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex max-w-md animate-fade-in items-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold shadow-pop ${
              t.kind === 'error' ? 'bg-negative text-white' : t.kind === 'info' ? 'bg-ink text-white' : 'bg-primary text-ink'
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
