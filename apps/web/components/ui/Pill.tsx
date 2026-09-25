import type { ReactNode } from 'react';

export type Tone = 'neutral' | 'lime' | 'good' | 'warn' | 'bad' | 'info' | 'dark';

const tones: Record<Tone, string> = {
  neutral: 'bg-canvas-sunk text-body',
  lime: 'bg-primary-pale text-primary-deep',
  good: 'bg-positive-bg text-positive',
  warn: 'bg-warning-bg text-warning-deep',
  bad: 'bg-negative-bg text-negative',
  info: 'bg-info-bg text-info',
  dark: 'bg-ink text-white',
};

/** Status is always a colour AND a word. */
export function Pill({ tone = 'neutral', children, className = '' }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${tones[tone]} ${className}`}>
      {children}
    </span>
  );
}
