import type { Config } from 'tailwindcss';

/**
 * Design tokens. The palette is the project's existing lime-on-ink identity;
 * status colours always come paired with a word in the UI (never colour alone).
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Archivo', '"Noto Sans Ethiopic"', '"Helvetica Neue"', 'Arial', 'sans-serif'],
        sans: ['"IBM Plex Sans"', '"Noto Sans Ethiopic"', 'system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'Menlo', 'monospace'],
      },
      colors: {
        ink: { DEFAULT: '#0e0f0c', soft: '#2a2d27', deep: '#163300' },
        body: '#454745',
        mute: '#6f736c',
        line: { DEFAULT: '#dadfd5', soft: '#e8ebe6' },
        canvas: { DEFAULT: '#ffffff', soft: '#f3f5f0', sunk: '#e8ebe6' },
        primary: { DEFAULT: '#9fe870', on: '#0e0f0c', active: '#b8f08f', pale: '#e2f6d5', deep: '#1f4a05' },
        positive: { DEFAULT: '#1d7a37', bg: '#dcf3e2' },
        warning: { DEFAULT: '#ffd11a', bg: '#fff4cc', deep: '#6b4d00' },
        negative: { DEFAULT: '#b3261e', bg: '#fbe4e2', deep: '#7a1712' },
        info: { DEFAULT: '#1e4fb8', bg: '#e1eafc' },
        // Table / ticket states
        state: {
          free: '#f3f5f0',
          seated: '#fff4cc',
          ready: '#c9f2d4',
          bill: '#ffe1c2',
          off: '#e8ebe6',
        },
        kds: {
          bg: '#0e0f0c',
          card: '#1c1f1a',
          line: '#2b2f28',
          text: '#eef1ea',
          mute: '#8d9288',
          fresh: '#26361c',
          warn: '#5a4200',
          late: '#6b1a1d',
        },
      },
      fontSize: {
        'display-xl': ['44px', { lineHeight: '48px', letterSpacing: '-0.02em', fontWeight: '900' }],
        'display-lg': ['32px', { lineHeight: '36px', letterSpacing: '-0.015em', fontWeight: '800' }],
        'display-md': ['24px', { lineHeight: '28px', letterSpacing: '-0.01em', fontWeight: '800' }],
        'display-sm': ['19px', { lineHeight: '24px', fontWeight: '700' }],
      },
      borderRadius: { sm: '8px', md: '12px', lg: '16px', xl: '22px' },
      boxShadow: {
        card: '0 1px 2px rgba(14,15,12,.06), 0 6px 18px rgba(14,15,12,.06)',
        sheet: '0 -8px 32px rgba(14,15,12,.18)',
        pop: '0 12px 40px rgba(14,15,12,.22)',
      },
      keyframes: {
        'slide-up': { from: { transform: 'translateY(100%)' }, to: { transform: 'translateY(0)' } },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        pulse2: { '0%,100%': { opacity: '1' }, '50%': { opacity: '.55' } },
      },
      animation: {
        'slide-up': 'slide-up .22s cubic-bezier(.2,.8,.2,1)',
        'fade-in': 'fade-in .15s ease-out',
        pulse2: 'pulse2 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
export default config;
