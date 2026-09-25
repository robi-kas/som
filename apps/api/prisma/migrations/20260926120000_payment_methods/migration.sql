-- Configurable payment methods per branch (mobile money, bank apps, "other bank").
ALTER TABLE "Payment" ADD COLUMN "methodName" TEXT;
ALTER TABLE "Payment" ADD COLUMN "payerBank" TEXT;

CREATE TABLE "PaymentMethod" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "requiresReference" BOOLEAN NOT NULL DEFAULT true,
    "requiresProof" BOOLEAN NOT NULL DEFAULT false,
    "requiresVerification" BOOLEAN NOT NULL DEFAULT true,
    "askPayerBank" BOOLEAN NOT NULL DEFAULT false,
    "accountInfo" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentMethod_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PaymentMethod_branchId_code_key" ON "PaymentMethod"("branchId", "code");
ALTER TABLE "PaymentMethod" ADD CONSTRAINT "PaymentMethod_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Default methods for every existing branch, so the till keeps working after upgrading.
-- Rarely used ones start switched off; the owner turns on what the cafe actually accepts.
INSERT INTO "PaymentMethod" ("id", "branchId", "code", "name", "kind", "requiresReference", "requiresProof", "requiresVerification", "askPayerBank", "isActive", "displayOrder")
SELECT gen_random_uuid()::text, b."id", m.code, m.name, m.kind, m.ref, m.proof, m.verify, m.bank, m.active, m.ord
FROM "Branch" b
CROSS JOIN (VALUES
  ('CASH',          'Cash',               'CASH',         false, false, false, false, true,  1),
  ('CARD',          'Card (POS machine)', 'CARD',         false, false, false, false, true,  2),
  ('TELEBIRR',      'Telebirr',           'MOBILE_MONEY', true,  false, true,  false, true,  3),
  ('CBE_BIRR',      'CBE Birr',           'MOBILE_MONEY', true,  false, true,  false, true,  4),
  ('CBE_MOBILE',    'CBE Mobile Banking', 'BANK_APP',     true,  true,  true,  false, true,  5),
  ('MPESA',         'M-PESA',             'MOBILE_MONEY', true,  false, true,  false, true,  6),
  ('AWASH_BIRR',    'Awash Birr',         'MOBILE_MONEY', true,  false, true,  false, false, 7),
  ('AMOLE',         'Amole (Dashen)',     'BANK_APP',     true,  true,  true,  false, false, 8),
  ('BOA_APOLLO',    'Apollo (BoA)',       'BANK_APP',     true,  true,  true,  false, false, 9),
  ('HELLOCASH',     'HelloCash',          'MOBILE_MONEY', true,  false, true,  false, false, 10),
  ('KACHA',         'Kacha',              'MOBILE_MONEY', true,  false, true,  false, false, 11),
  ('EBIRR',         'E-Birr',             'MOBILE_MONEY', true,  false, true,  false, false, 12),
  ('ZEMEN_BANK',    'Zemen Bank app',     'BANK_APP',     true,  true,  true,  false, false, 13),
  ('HIBRET_BANK',   'Hibret Bank app',    'BANK_APP',     true,  true,  true,  false, false, 14),
  ('AMHARA_BANK',   'Amhara Bank app',    'BANK_APP',     true,  true,  true,  false, false, 15),
  ('OROMIA_BANK',   'Oromia Bank app',    'BANK_APP',     true,  true,  true,  false, false, 16),
  ('COOP_BANK',     'Coopay (Coop Bank)', 'BANK_APP',     true,  true,  true,  false, false, 17),
  ('BANK_TRANSFER', 'Bank transfer',      'BANK_APP',     true,  true,  true,  false, true,  18),
  ('OTHER_BANK',    'Other bank / app',   'OTHER',        true,  true,  true,  true,  true,  19)
) AS m(code, name, kind, ref, proof, verify, bank, active, ord)
ON CONFLICT ("branchId", "code") DO NOTHING;

UPDATE "Payment" SET "methodName" = CASE "method"
  WHEN 'CASH' THEN 'Cash' WHEN 'CARD' THEN 'Card (POS machine)' WHEN 'TELEBIRR' THEN 'Telebirr'
  WHEN 'CBE_BIRR' THEN 'CBE Birr' WHEN 'BANK_TRANSFER' THEN 'Bank transfer' ELSE "method" END
WHERE "methodName" IS NULL;
