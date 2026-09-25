/*
  Warnings:

  - You are about to drop the column `timestamp` on the `CashMovement` table. All the data in the column will be lost.
  - You are about to drop the column `idempotencyKey` on the `Payment` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "Payment_organizationId_idempotencyKey_key";

-- AlterTable
ALTER TABLE "CashMovement" DROP COLUMN "timestamp",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Payment" DROP COLUMN "idempotencyKey";
