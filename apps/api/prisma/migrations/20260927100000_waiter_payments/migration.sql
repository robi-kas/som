-- Waiters can record transfer payments from their phone, and carry change money ("float").
ALTER TABLE "BranchConfiguration"
  ADD COLUMN "waiterPayments" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "waiterPhotoRequired" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "waiterFloatDefault" DECIMAL(18,2) NOT NULL DEFAULT 500;

ALTER TABLE "Payment"
  ADD COLUMN "reportedByWaiter" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "floatId" TEXT;

CREATE TABLE "WaiterFloat" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "waiterId" TEXT NOT NULL,
    "issuedById" TEXT NOT NULL,
    "issuedShiftId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "changeGiven" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "returnedAmount" DECIMAL(18,2),
    "variance" DECIMAL(18,2),
    "settledById" TEXT,
    "settledShiftId" TEXT,
    "note" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "WaiterFloat_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WaiterFloat_amount_positive" CHECK ("amount" > 0),
    CONSTRAINT "WaiterFloat_change_within" CHECK ("changeGiven" >= 0 AND "changeGiven" <= "amount")
);
CREATE INDEX "WaiterFloat_branchId_status_idx" ON "WaiterFloat"("branchId", "status");
CREATE INDEX "WaiterFloat_waiterId_status_idx" ON "WaiterFloat"("waiterId", "status");
ALTER TABLE "WaiterFloat" ADD CONSTRAINT "WaiterFloat_waiterId_fkey" FOREIGN KEY ("waiterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- One open float per waiter per branch.
CREATE UNIQUE INDEX "WaiterFloat_one_open_per_waiter" ON "WaiterFloat"("waiterId", "branchId") WHERE "status" = 'OPEN';

-- Waiters get the new "report a transfer" permission (seed keeps this in sync too).
INSERT INTO "Permission" ("id", "code", "description")
SELECT gen_random_uuid()::text, 'payment.report', 'Record a transfer payment with a photo from a waiter phone'
WHERE NOT EXISTS (SELECT 1 FROM "Permission" WHERE "code" = 'payment.report');

INSERT INTO "RolePermission" ("id", "roleId", "permissionId")
SELECT gen_random_uuid()::text, r."id", p."id"
FROM "Role" r CROSS JOIN "Permission" p
WHERE p."code" = 'payment.report' AND r."name" IN ('Waiter', 'Counter', 'Cashier', 'Supervisor', 'Manager')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
