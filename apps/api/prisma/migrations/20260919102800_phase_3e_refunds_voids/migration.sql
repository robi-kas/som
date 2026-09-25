/*
  Phase 3E: Refunds and Voids

  Note: pre-existing `Refund` and `RefundItem` tables were scaffolded in an
  earlier phase but never wired into any service, job, or test. Verified empty
  at authoring time. They are dropped and recreated here to match the Phase 3E
  schema in one clean step instead of a destructive ALTER sequence.
*/

-- DropForeignKey
ALTER TABLE "RefundItem" DROP CONSTRAINT IF EXISTS "RefundItem_refundId_fkey";

-- DropTable (greenfield; verified empty)
DROP TABLE IF EXISTS "RefundItem";
DROP TABLE IF EXISTS "Refund";

-- CreateTable
CREATE TABLE "Refund" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "branchId"       TEXT NOT NULL,
  "orderId"        TEXT NOT NULL,
  "paymentId"      TEXT NOT NULL,
  "amount"         DECIMAL(18,2) NOT NULL,
  "method"         VARCHAR(32) NOT NULL,
  "status"         VARCHAR(32) NOT NULL,
  "reason"         TEXT NOT NULL,
  "initiatedById"  TEXT NOT NULL,
  "approvedById"   TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmedAt"    TIMESTAMP(3),
  CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RefundItem" (
  "id"             TEXT NOT NULL,
  "refundId"       TEXT NOT NULL,
  "orderItemId"    TEXT NOT NULL,
  "quantity"       DECIMAL(12,3) NOT NULL,
  "refundedAmount" DECIMAL(18,2) NOT NULL,
  CONSTRAINT "RefundItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VoidRecord" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "branchId"       TEXT NOT NULL,
  "orderId"        TEXT NOT NULL,
  "reason"         TEXT NOT NULL,
  "voidedById"     TEXT NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VoidRecord_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "Refund_orderId_idx"                ON "Refund"("orderId");
CREATE INDEX "Refund_paymentId_idx"              ON "Refund"("paymentId");
CREATE INDEX "Refund_branchId_status_idx"        ON "Refund"("branchId", "status");
CREATE INDEX "RefundItem_refundId_idx"           ON "RefundItem"("refundId");
CREATE INDEX "RefundItem_orderItemId_idx"        ON "RefundItem"("orderItemId");
CREATE INDEX "VoidRecord_orderId_idx"            ON "VoidRecord"("orderId");
CREATE INDEX "VoidRecord_branchId_createdAt_idx" ON "VoidRecord"("branchId", "createdAt");

-- FKs
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_branchId_fkey"       FOREIGN KEY ("branchId")       REFERENCES "Branch"("id")       ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_orderId_fkey"        FOREIGN KEY ("orderId")        REFERENCES "Order"("id")        ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_paymentId_fkey"      FOREIGN KEY ("paymentId")      REFERENCES "Payment"("id")      ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_initiatedById_fkey"  FOREIGN KEY ("initiatedById")  REFERENCES "User"("id")         ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_approvedById_fkey"   FOREIGN KEY ("approvedById")   REFERENCES "User"("id")         ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RefundItem" ADD CONSTRAINT "RefundItem_refundId_fkey"    FOREIGN KEY ("refundId")    REFERENCES "Refund"("id")    ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "RefundItem" ADD CONSTRAINT "RefundItem_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VoidRecord" ADD CONSTRAINT "VoidRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VoidRecord" ADD CONSTRAINT "VoidRecord_branchId_fkey"       FOREIGN KEY ("branchId")       REFERENCES "Branch"("id")       ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VoidRecord" ADD CONSTRAINT "VoidRecord_orderId_fkey"        FOREIGN KEY ("orderId")        REFERENCES "Order"("id")        ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VoidRecord" ADD CONSTRAINT "VoidRecord_voidedById_fkey"     FOREIGN KEY ("voidedById")     REFERENCES "User"("id")         ON DELETE RESTRICT ON UPDATE CASCADE;
