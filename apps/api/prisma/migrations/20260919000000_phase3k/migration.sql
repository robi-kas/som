-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "deviceId" TEXT;

-- CreateTable
DROP TABLE IF EXISTS "SyncEvent";
CREATE TABLE "SyncEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "localEventId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "clientTimestamp" TIMESTAMP(3) NOT NULL,
    "serverReceivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncStatus" TEXT NOT NULL,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "serverEntityId" TEXT,

    CONSTRAINT "SyncEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SyncEvent_organizationId_syncStatus_idx" ON "SyncEvent"("organizationId", "syncStatus");

-- CreateIndex
CREATE UNIQUE INDEX "SyncEvent_deviceId_localEventId_key" ON "SyncEvent"("deviceId", "localEventId");

