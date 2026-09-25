-- AlterTable
ALTER TABLE "BranchConfiguration" ADD COLUMN     "varianceTolerance" DECIMAL(18,2) NOT NULL DEFAULT 0.00;

-- CreateTable
CREATE TABLE "CashCount" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "denomination" DECIMAL(18,2) NOT NULL,
    "count" INTEGER NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftReconciliation" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "expectedCash" DECIMAL(18,2) NOT NULL,
    "actualCash" DECIMAL(18,2) NOT NULL,
    "variance" DECIMAL(18,2) NOT NULL,
    "openingFloat" DECIMAL(18,2) NOT NULL,
    "cashSales" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "cashRefunds" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "cashDeposits" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "cashWithdrawals" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approvedById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftReconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CashCount_shiftId_idx" ON "CashCount"("shiftId");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftReconciliation_shiftId_key" ON "ShiftReconciliation"("shiftId");

-- AddForeignKey
ALTER TABLE "CashCount" ADD CONSTRAINT "CashCount_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "CashierShift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftReconciliation" ADD CONSTRAINT "ShiftReconciliation_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "CashierShift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftReconciliation" ADD CONSTRAINT "ShiftReconciliation_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
