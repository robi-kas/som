'use client';

import { useMemo, useState } from 'react';

/**
 * Single-series charts for the back office, per the dataviz spec:
 * one hue, columns ≤ 24px with a 4px rounded data-end on a single baseline, hairline
 * recessive grid, clean y ticks, a hover/focus tooltip on every mark, selective labels
 * (only the peak), and a table view so nothing is hover-only.
 */

const MARK = '#1f4a05'; // primary-deep: one hue for magnitude
const MARK_HOVER = '#3b7a17';

function niceMax(v: number) {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * exp;
}

const fmt = (n: number) => new Intl.NumberFormat('en-US', { notation: n >= 100_000 ? 'compact' : 'standard', maximumFractionDigits: n >= 100_000 ? 1 : 0 }).format(n);

export interface Datum {
  label: string; // axis label
  value: number;
  detail?: string; // tooltip secondary line
}

export function ColumnChart({ data, height = 200, unit = '', title }: { data: Datum[]; height?: number; unit?: string; title: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const max = useMemo(() => niceMax(Math.max(0, ...data.map((d) => d.value))), [data]);
  const ticks = [0, max / 2, max];
  const peak = data.reduce((best, d, i) => (d.value > (data[best]?.value ?? -1) ? i : best), 0);

  const W = 640;
  const padL = 44;
  const padB = 22;
  const padT = 18;
  const plotW = W - padL - 8;
  const plotH = height - padB - padT;
  const band = plotW / Math.max(1, data.length);
  const barW = Math.min(24, Math.max(4, band - 2)); // ≥2px surface gap between neighbours
  const y = (v: number) => padT + plotH - (v / max) * plotH;
  const labelEvery = Math.ceil(data.length / 10);

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="flex items-center justify-between">
        <span className="text-sm font-semibold text-ink">{title}</span>
        <button onClick={() => setAsTable((v) => !v)} className="text-xs font-semibold text-mute underline-offset-2 hover:text-ink hover:underline">
          {asTable ? 'Show chart' : 'Show table'}
        </button>
      </figcaption>
      {asTable ? (
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-sm tnum">
            <tbody>
              {data.map((d) => (
                <tr key={d.label} className="border-b border-line-soft">
                  <td className="py-1.5 text-body">{d.label}</td>
                  <td className="py-1.5 text-right font-semibold">
                    {d.value.toLocaleString('en-US')} {unit}
                  </td>
                  {d.detail && <td className="py-1.5 pl-3 text-right text-mute">{d.detail}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${height}`} className="h-auto w-full" role="img" aria-label={title}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={padL} x2={W - 8} y1={y(t)} y2={y(t)} stroke="#e8ebe6" strokeWidth={1} />
                <text x={padL - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="#6f736c" className="tnum">
                  {fmt(t)}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const x = padL + i * band + (band - barW) / 2;
              const top = y(d.value);
              const h = Math.max(0, padT + plotH - top);
              const r = Math.min(4, barW / 2, h);
              // Rounded data-end, square at the baseline.
              const path = h > 0 ? `M${x},${padT + plotH} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${padT + plotH} Z` : '';
              return (
                <g key={d.label}>
                  {path && <path d={path} fill={hover === i ? MARK_HOVER : MARK} />}
                  {i === peak && d.value > 0 && (
                    <text x={x + barW / 2} y={top - 5} textAnchor="middle" fontSize={11} fontWeight={600} fill="#0e0f0c" className="tnum">
                      {fmt(d.value)}
                    </text>
                  )}
                  {i % labelEvery === 0 && (
                    <text x={x + barW / 2} y={height - 6} textAnchor="middle" fontSize={10.5} fill="#6f736c">
                      {d.label}
                    </text>
                  )}
                  {/* Hit target: the whole band, taller than the mark. */}
                  <rect
                    x={padL + i * band}
                    y={padT}
                    width={band}
                    height={plotH}
                    fill="transparent"
                    tabIndex={0}
                    aria-label={`${d.label}: ${d.value} ${unit}`}
                    onPointerEnter={() => setHover(i)}
                    onPointerLeave={() => setHover(null)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                    style={{ outline: 'none' }}
                  />
                </g>
              );
            })}
            <line x1={padL} x2={W - 8} y1={padT + plotH} y2={padT + plotH} stroke="#dadfd5" strokeWidth={1} />
          </svg>
          {hover !== null && data[hover] && (
            <div
              className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-md border border-line bg-canvas px-3 py-2 text-xs shadow-pop"
              style={{ left: `${((padL + hover * band + band / 2) / W) * 100}%` }}
            >
              <p className="text-sm font-semibold text-ink tnum">
                {data[hover].value.toLocaleString('en-US')} {unit}
              </p>
              <p className="text-mute">
                {data[hover].label}
                {data[hover].detail ? ` · ${data[hover].detail}` : ''}
              </p>
            </div>
          )}
        </div>
      )}
    </figure>
  );
}

/** Ranked horizontal bars (payment methods, best sellers): label left, value at the tip. */
export function BarList({ data, unit = '', title, empty = 'No data yet' }: { data: Datum[]; unit?: string; title: string; empty?: string }) {
  const max = Math.max(0, ...data.map((d) => d.value));
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-sm font-semibold text-ink">{title}</figcaption>
      {data.length === 0 ? (
        <p className="py-6 text-center text-sm text-mute">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {data.map((d) => (
            <li key={d.label} className="grid grid-cols-[minmax(0,9rem)_1fr] items-center gap-3 text-sm" title={d.detail}>
              <span className="truncate text-body">{d.label}</span>
              <span className="flex items-center gap-2">
                <span className="h-3 rounded-r-[4px]" style={{ width: `${max ? Math.max(1.5, (d.value / max) * 78) : 0}%`, background: MARK }} />
                <span className="shrink-0 font-semibold text-ink tnum">
                  {d.value.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                  {unit && <span className="ml-0.5 font-normal text-mute">{unit}</span>}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}

/** Stat tile: label, value (sans, semibold), optional note. */
export function StatTile({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: 'attention' }) {
  return (
    <div className={`flex flex-col gap-1 rounded-lg border p-4 ${tone === 'attention' ? 'border-[#f0d77a] bg-warning-bg' : 'border-line bg-canvas'}`}>
      <span className="text-xs font-semibold text-mute">{label}</span>
      <span className="font-sans text-[28px] font-semibold leading-tight text-ink">{value}</span>
      {note && <span className="text-xs text-mute">{note}</span>}
    </div>
  );
}
