import type { ReactNode } from 'react';

export function Empty({ title, children, action }: { title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <p className="font-display text-display-sm text-ink">{title}</p>
      {children && <p className="max-w-sm text-sm text-mute">{children}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
