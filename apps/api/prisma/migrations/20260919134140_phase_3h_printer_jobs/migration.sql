/*
  Warnings:

  - You are about to drop the column `retryCount` on the `PrinterJob` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "PrinterJob" DROP COLUMN "retryCount",
ADD COLUMN     "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "errorMessage" TEXT,
ADD COLUMN     "isReprint" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "printedAt" TIMESTAMP(3);
