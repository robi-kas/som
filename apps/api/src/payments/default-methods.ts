/**
 * Payment methods a new branch starts with. Ethiopian mobile money and bank apps; the rarely
 * used ones start switched off. Owners edit this list in Settings → Payment methods.
 * Keep in sync with the 20260926120000_payment_methods migration.
 */
export interface DefaultMethod {
  code: string;
  name: string;
  kind: 'CASH' | 'CARD' | 'MOBILE_MONEY' | 'BANK_APP' | 'OTHER';
  requiresReference: boolean;
  requiresProof: boolean;
  requiresVerification: boolean;
  askPayerBank: boolean;
  isActive: boolean;
}

const m = (code: string, name: string, kind: DefaultMethod['kind'], ref: boolean, proof: boolean, verify: boolean, bank: boolean, active: boolean): DefaultMethod => ({
  code, name, kind, requiresReference: ref, requiresProof: proof, requiresVerification: verify, askPayerBank: bank, isActive: active,
});

export const DEFAULT_PAYMENT_METHODS: DefaultMethod[] = [
  m('CASH', 'Cash', 'CASH', false, false, false, false, true),
  m('CARD', 'Card (POS machine)', 'CARD', false, false, false, false, true),
  m('TELEBIRR', 'Telebirr', 'MOBILE_MONEY', true, false, true, false, true),
  m('CBE_BIRR', 'CBE Birr', 'MOBILE_MONEY', true, false, true, false, true),
  m('CBE_MOBILE', 'CBE Mobile Banking', 'BANK_APP', true, true, true, false, true),
  m('MPESA', 'M-PESA', 'MOBILE_MONEY', true, false, true, false, true),
  m('AWASH_BIRR', 'Awash Birr', 'MOBILE_MONEY', true, false, true, false, false),
  m('AMOLE', 'Amole (Dashen)', 'BANK_APP', true, true, true, false, false),
  m('BOA_APOLLO', 'Apollo (BoA)', 'BANK_APP', true, true, true, false, false),
  m('HELLOCASH', 'HelloCash', 'MOBILE_MONEY', true, false, true, false, false),
  m('KACHA', 'Kacha', 'MOBILE_MONEY', true, false, true, false, false),
  m('EBIRR', 'E-Birr', 'MOBILE_MONEY', true, false, true, false, false),
  m('ZEMEN_BANK', 'Zemen Bank app', 'BANK_APP', true, true, true, false, false),
  m('HIBRET_BANK', 'Hibret Bank app', 'BANK_APP', true, true, true, false, false),
  m('AMHARA_BANK', 'Amhara Bank app', 'BANK_APP', true, true, true, false, false),
  m('OROMIA_BANK', 'Oromia Bank app', 'BANK_APP', true, true, true, false, false),
  m('COOP_BANK', 'Coopay (Coop Bank)', 'BANK_APP', true, true, true, false, false),
  m('BANK_TRANSFER', 'Bank transfer', 'BANK_APP', true, true, true, false, true),
  m('OTHER_BANK', 'Other bank / app', 'OTHER', true, true, true, true, true),
];
