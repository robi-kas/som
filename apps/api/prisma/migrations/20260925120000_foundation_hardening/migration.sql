-- Phase 0/1 foundation: manager PIN approvals, server-priced add-ons, order counters,
-- discounts, printer health, and a database-level guard against reusing a digital
-- payment reference.
--
-- NOTE for future `prisma migrate dev` runs: Prisma cannot express partial indexes, so
-- it may generate DROP INDEX lines for "Payment_unique_reference", "uq_active_order_per_table"
-- and "uq_active_cashier_shift". Delete those lines from the generated migration.

-- User ------------------------------------------------------------------------
ALTER TABLE "User" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "User" ADD COLUMN "pinHash" TEXT;
ALTER TABLE "User" ADD COLUMN "pinFailedCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "pinLockedUntil" TIMESTAMP(3);

-- ProductModifier ---------------------------------------------------------------
CREATE TABLE "ProductModifier" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceDelta" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductModifier_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProductModifier_productId_idx" ON "ProductModifier"("productId");
ALTER TABLE "ProductModifier" ADD CONSTRAINT "ProductModifier_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Order -------------------------------------------------------------------------
ALTER TABLE "Order" ADD COLUMN "discountType" TEXT;
ALTER TABLE "Order" ADD COLUMN "discountValue" DECIMAL(18,2);
ALTER TABLE "Order" ADD COLUMN "discountReason" TEXT;
ALTER TABLE "Order" ADD COLUMN "discountAppliedById" TEXT;
ALTER TABLE "Order" ADD COLUMN "discountApprovedById" TEXT;
ALTER TABLE "Order" ADD COLUMN "closedAt" TIMESTAMP(3);

-- (One open order per table is already enforced by "uq_active_order_per_table"
--  from the 20260918131057_manual_indexes migration.)

-- Payment -----------------------------------------------------------------------
ALTER TABLE "Payment" ADD COLUMN "rejectedReason" TEXT;

-- The same Telebirr / CBE Birr transaction reference cannot be used twice.
CREATE UNIQUE INDEX "Payment_unique_reference"
    ON "Payment"("organizationId", "method", "referenceNumber")
    WHERE "referenceNumber" IS NOT NULL AND "status" <> 'REJECTED';

-- Printer -----------------------------------------------------------------------
ALTER TABLE "Printer" ADD COLUMN "branchId" TEXT;
UPDATE "Printer" p SET "branchId" = s."branchId" FROM "KitchenStation" s WHERE s."id" = p."stationId";
ALTER TABLE "Printer" ALTER COLUMN "branchId" SET NOT NULL;
ALTER TABLE "Printer" ALTER COLUMN "stationId" DROP NOT NULL;
ALTER TABLE "Printer" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'KITCHEN';
ALTER TABLE "Printer" ADD COLUMN "port" INTEGER NOT NULL DEFAULT 9100;
ALTER TABLE "Printer" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE "Printer" ADD COLUMN "lastSeenAt" TIMESTAMP(3);
ALTER TABLE "Printer" ADD COLUMN "lastError" TEXT;
ALTER TABLE "Printer" ADD CONSTRAINT "Printer_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PrinterJob" ADD COLUMN "claimedAt" TIMESTAMP(3);

CREATE TABLE "PrintAgent" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PrintAgent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PrintAgent_keyHash_key" ON "PrintAgent"("keyHash");
ALTER TABLE "PrintAgent" ADD CONSTRAINT "PrintAgent_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- BranchConfiguration ----------------------------------------------------------
ALTER TABLE "BranchConfiguration" ADD COLUMN "largeDiscountPercent" DECIMAL(5,2) NOT NULL DEFAULT 10.00;
ALTER TABLE "BranchConfiguration" ADD COLUMN "cashierRefundLimit" DECIMAL(18,2) NOT NULL DEFAULT 500.00;
ALTER TABLE "BranchConfiguration" ADD COLUMN "ticketWarnMinutes" INTEGER NOT NULL DEFAULT 8;
ALTER TABLE "BranchConfiguration" ADD COLUMN "ticketLateMinutes" INTEGER NOT NULL DEFAULT 12;
ALTER TABLE "BranchConfiguration" ADD COLUMN "tinNumber" TEXT;
ALTER TABLE "BranchConfiguration" ADD COLUMN "receiptFooter" TEXT;

-- BranchCounter -----------------------------------------------------------------
CREATE TABLE "BranchCounter" (
    "branchId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "BranchCounter_pkey" PRIMARY KEY ("branchId", "scope")
);

-- ApprovalGrant -----------------------------------------------------------------
CREATE TABLE "ApprovalGrant" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "usedFor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApprovalGrant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ApprovalGrant_tokenHash_key" ON "ApprovalGrant"("tokenHash");
CREATE INDEX "ApprovalGrant_organizationId_createdAt_idx" ON "ApprovalGrant"("organizationId", "createdAt");
ALTER TABLE "ApprovalGrant" ADD CONSTRAINT "ApprovalGrant_approverId_fkey"
    FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
