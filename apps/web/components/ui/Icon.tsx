/** Small inline icon set (stroke icons, 24px grid). */
const paths: Record<string, string> = {
  tables: 'M4 7h16M6 7v11M18 7v11M9 18h6',
  cash: 'M3 7h18v10H3zM7 12h.01M17 12h.01M12 14.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
  kitchen: 'M6 3v8M4 3v4a2 2 0 004 0V3M6 11v10M16 3c-1.7 0-3 2.2-3 5s1.3 4 3 4v9',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  menu: 'M4 6h16M4 12h16M4 18h10',
  users: 'M16 19v-1a4 4 0 00-4-4H7a4 4 0 00-4 4v1M9.5 10a3 3 0 100-6 3 3 0 000 6zM21 19v-1a4 4 0 00-3-3.9M16 4.1a3 3 0 010 5.8',
  printer: 'M6 9V3h12v6M6 18H4a1 1 0 01-1-1v-6a2 2 0 012-2h14a2 2 0 012 2v6a1 1 0 01-1 1h-2M6 14h12v7H6z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  bell: 'M18 16v-5a6 6 0 10-12 0v5l-2 2h16zM10 21h4',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  x: 'M6 6l12 12M18 6L6 18',
  back: 'M15 18l-6-6 6-6',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-4.3-4.3',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 118 0v4',
  move: 'M5 12h14M13 6l6 6-6 6',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  wifiOff: 'M3 3l18 18M8.5 16.5a5 5 0 017 0M5 12.5a10 10 0 014.3-2.4M19 12.5a10 10 0 00-2.2-1.5M2 8.8a15 15 0 014.2-2.6M22 8.8A15 15 0 0012 5c-.9 0-1.7.1-2.6.2M12 20h.01',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  split: 'M12 3v18M5 8l-3 4 3 4M19 8l3 4-3 4',
  tag: 'M3 12V4h8l10 10-8 8zM7.5 8.5h.01',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1A1.7 1.7 0 009 19.4a1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1A1.7 1.7 0 004.6 15a1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1A1.7 1.7 0 004.6 9a1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1A1.7 1.7 0 009 4.6 1.7 1.7 0 0010 3.1V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1A1.7 1.7 0 0019.4 9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
  log: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  refresh: 'M21 12a9 9 0 11-3-6.7L21 8M21 3v5h-5',
  camera: 'M3 8h4l2-3h6l2 3h4v12H3zM12 17a4 4 0 100-8 4 4 0 000 8z',
  volume: 'M11 5L6 9H2v6h4l5 4zM15.5 8.5a5 5 0 010 7M19 5a10 10 0 010 14',
};

export type IconName = keyof typeof paths;

export function Icon({ name, size = 20, className = '', strokeWidth = 2 }: { name: IconName; size?: number; className?: string; strokeWidth?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
