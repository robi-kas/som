-- DropForeignKey
ALTER TABLE "Order" DROP CONSTRAINT "Order_waiterId_fkey";

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "currency" CHAR(3) NOT NULL,
ALTER COLUMN "orderNumber" DROP DEFAULT,
ALTER COLUMN "orderNumber" SET DATA TYPE TEXT;
DROP SEQUENCE "Order_orderNumber_seq";

-- AlterTable
ALTER TABLE "OrderItem" DROP COLUMN "productNameSnap",
DROP COLUMN "unitPriceSnap",
ADD COLUMN     "productNameSnapshot" TEXT NOT NULL,
ADD COLUMN     "unitPriceSnapshot" DECIMAL(18,2) NOT NULL;

-- AlterTable
ALTER TABLE "Payment" ALTER COLUMN "currency" DROP DEFAULT;

-- CreateTable
CREATE TABLE "BranchConfiguration" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 15.00,
    "isTaxInclusive" BOOLEAN NOT NULL DEFAULT false,
    "serviceChargeRate" DECIMAL(5,2) NOT NULL DEFAULT 10.00,
    "roundingMode" TEXT NOT NULL DEFAULT 'HALF_UP',
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "BranchConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItemStatusHistory" (
    "id" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "fromStatus" TEXT NOT NULL,
    "toStatus" TEXT NOT NULL,
    "changedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderItemStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BranchConfiguration_branchId_key" ON "BranchConfiguration"("branchId");

-- CreateIndex
CREATE INDEX "OrderItemStatusHistory_orderItemId_idx" ON "OrderItemStatusHistory"("orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_branchId_orderNumber_key" ON "Order"("branchId", "orderNumber");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_waiterId_fkey" FOREIGN KEY ("waiterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchConfiguration" ADD CONSTRAINT "BranchConfiguration_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemStatusHistory" ADD CONSTRAINT "OrderItemStatusHistory_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemStatusHistory" ADD CONSTRAINT "OrderItemStatusHistory_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

