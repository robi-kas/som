/**
 * Payment method logo. Bank and wallet logos come from Chapa's ethiopianlogos.com collection
 * (MIT; see public/payment-logos/LICENSE-ethiopianlogos.txt). Methods without a published logo
 * (M-PESA, HelloCash, E-Birr, cards, custom ones) get a clean lettermark instead of a fake logo.
 */
const LOGOS: Record<string, string> = {
  TELEBIRR: '/payment-logos/telebirr.svg',
  CBE_BIRR: '/payment-logos/cbe-birr.svg',
  CBE_MOBILE: '/payment-logos/cbe.svg',
  AWASH_BIRR: '/payment-logos/awash.svg',
  AMOLE: '/payment-logos/amole.svg',
  BOA_APOLLO: '/payment-logos/boa.svg',
  KACHA: '/payment-logos/kacha.svg',
  DASHEN_BANK: '/payment-logos/dashen.svg',
  ZEMEN_BANK: '/payment-logos/zemen.svg',
  HIBRET_BANK: '/payment-logos/hibret.svg',
  AMHARA_BANK: '/payment-logos/amhara.svg',
  OROMIA_BANK: '/payment-logos/oromia.png',
  COOP_BANK: '/payment-logos/coop.svg',
};

// Custom methods an owner adds by name ("Zemen Bank") still find their logo.
const BY_WORD: [RegExp, string][] = [
  [/tele ?birr/i, LOGOS.TELEBIRR],
  [/cbe ?birr/i, LOGOS.CBE_BIRR],
  [/\bcbe\b|commercial bank/i, LOGOS.CBE_MOBILE],
  [/awash/i, LOGOS.AWASH_BIRR],
  [/amole/i, LOGOS.AMOLE],
  [/dashen/i, LOGOS.DASHEN_BANK],
  [/abyssinia|apollo|\bboa\b/i, LOGOS.BOA_APOLLO],
  [/kacha/i, LOGOS.KACHA],
  [/zemen/i, LOGOS.ZEMEN_BANK],
  [/hibret/i, LOGOS.HIBRET_BANK],
  [/amhara/i, LOGOS.AMHARA_BANK],
  [/oromia international|oromia bank/i, LOGOS.OROMIA_BANK],
  [/coop/i, LOGOS.COOP_BANK],
];

export function logoFor(code: string, name = ''): string | null {
  return LOGOS[code] ?? BY_WORD.find(([re]) => re.test(name))?.[1] ?? null;
}

const MARK_COLORS: Record<string, string> = { CASH: '#1d7a37', CARD: '#0e0f0c', MPESA: '#3aa935', HELLOCASH: '#e4572e', EBIRR: '#1e4fb8', OTHER_BANK: '#6f736c', BANK_TRANSFER: '#1f4a05' };

export function MethodLogo({ code, name, size = 40 }: { code: string; name: string; size?: number }) {
  const src = logoFor(code, name);
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt="" width={size} height={size} loading="lazy" className="shrink-0 rounded-md bg-white object-contain p-0.5" style={{ width: size, height: size }} />
    );
  }
  if (code === 'CASH' || code === 'CARD') {
    return (
      <span className="grid shrink-0 place-items-center rounded-md text-white" style={{ width: size, height: size, background: MARK_COLORS[code] }} aria-hidden="true">
        <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {code === 'CASH' ? <path d="M3 7h18v10H3zM12 14.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" /> : <path d="M3 6h18v12H3zM3 10h18M7 15h4" />}
        </svg>
      </span>
    );
  }
  const letters = name
    .replace(/\(.*?\)/g, '')
    .split(/[\s/-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  return (
    <span
      className="grid shrink-0 place-items-center rounded-md font-display font-black text-white"
      style={{ width: size, height: size, background: MARK_COLORS[code] ?? '#454745', fontSize: size * 0.36 }}
      aria-hidden="true"
    >
      {letters || '?'}
    </span>
  );
}
