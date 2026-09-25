-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "reprintCount" INTEGER NOT NULL DEFAULT 0,
    "lastReprintedBy" TEXT,
    "lastReprintedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Receipt_orderId_idx" ON "Receipt"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_branchId_receiptNumber_key" ON "Receipt"("branchId", "receiptNumber");
