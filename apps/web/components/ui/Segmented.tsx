'use client';

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className = '',
  dark,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; badge?: number }[];
  className?: string;
  dark?: boolean;
}) {
  return (
    <div role="tablist" className={`hide-scrollbar flex gap-1.5 overflow-x-auto ${className}`}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.value)}
            className={`inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-semibold transition-colors ${
              on
                ? dark
                  ? 'bg-primary text-ink'
                  : 'bg-ink text-white'
                : dark
                  ? 'bg-kds-card text-kds-text hover:bg-kds-line'
                  : 'bg-canvas-sunk text-body hover:bg-line'
            }`}
          >
            {o.label}
            {o.badge ? (
              <span className={`rounded-full px-1.5 text-xs ${on ? 'bg-primary text-ink' : 'bg-ink text-white'}`}>{o.badge}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
