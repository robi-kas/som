-- DropIndex
DROP INDEX "Payment_idempotencyKey_key";

-- AlterTable
ALTER TABLE "CashMovement" ADD COLUMN     "sourceId" TEXT,
ADD COLUMN     "sourceType" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "evidenceId" TEXT,
ADD COLUMN     "organizationId" TEXT NOT NULL,
ADD COLUMN     "refundableAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ALTER COLUMN "idempotencyKey" DROP NOT NULL;

-- CreateTable
CREATE TABLE "PaymentEvidence" (
    "id" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "responseCode" INTEGER NOT NULL,
    "responseBody" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_organizationId_endpoint_idempotencyKey_key" ON "IdempotencyKey"("organizationId", "endpoint", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Payment_orderId_status_idx" ON "Payment"("orderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_organizationId_idempotencyKey_key" ON "Payment"("organizationId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "PaymentEvidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

